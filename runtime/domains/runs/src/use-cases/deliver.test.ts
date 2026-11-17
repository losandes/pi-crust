import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TEnvelopeBase, TRun } from '../../../../lib/contracts'
import { SKIP_INTEGRATION } from '../../../../testing/integration'
import { terminalOutput } from '../../../../testing/terminal-capture'
import { observedPayload, PATHS_TOUCHED } from '../../../policy'
import {
  COMMIT_REFUSED_EVENT,
  commitActivity,
  commitMessage,
  outstandingCommits,
  recommitRefused,
} from './deliver'
import {
  deliveryFixture,
  gitIn,
  refuseBuildCommit,
} from './run-terminal-fixture.test'

const git = (cwd: string, ...args: readonly string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

/**
 * A repository with one commit, so HEAD exists and a second commit can be
 * told from the first.
 */
const aRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'crust-deliver-'))
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 'tester@example.com')
  git(dir, 'config', 'user.name', 'tester')
  // Signing is the operator's business, not this fixture's: a machine that
  // signs through an agent hangs a non-interactive `git commit` for a minute
  // and then fails, which reads as a broken test rather than a broken prompt.
  git(dir, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(dir, 'README.md'), 'before\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', 'first')

  return dir
}

/** Every event the fake run recorded, so a test can read what it filed. */
const EVENTS = new WeakMap<object, Record<string, unknown>[]>()

/**
 * A run whose trace already holds what an Activity Run was observed to change.
 *
 * That record is `executeAgent`'s to write and `commitActivity`'s to read, and
 * it is the whole scope of the commit: a fake run that files nothing is a run
 * in which nothing was observed, which is exactly how an Activity that touched
 * no file behaves.
 */
const runIn = (
  observed: Readonly<Record<string, readonly string[]>> = {},
  dir = '',
): TRun => {
  const filed: Record<string, unknown>[] = []
  const run = {
    runId: 'aaaa1111',
    repoRoot: dir,
    vcsRoot: dir,
    console: { note: () => undefined },
    tracer: {
      event: (input: Readonly<Record<string, unknown>>) => {
        // biome-ignore lint/plugin/no-array-mutation: recording what was filed is the test
        filed.push(input)
      },
      eventsNamed: (_runId: string, name: string) =>
        name === PATHS_TOUCHED
          ? Object.entries(observed).map(([activity, touched]) =>
              observedPayload({
                activity,
                activityRunId: `id_${activity}`,
                agent: activity,
                touched,
                dirtyBefore: [],
                claimed: touched,
              }),
            )
          : filed
              .filter((event) => event.name === name)
              .map(
                (event) => event.payload as Readonly<Record<string, unknown>>,
              ),
    },
  } as unknown as TRun
  EVENTS.set(run, filed)

  return run
}

const eventsOf = (run: TRun): readonly Record<string, unknown>[] =>
  EVENTS.get(run) ?? []

const envelopeWith = (message: string): TEnvelopeBase =>
  ({
    status: 'success',
    summary: 'implemented the thing',
    artifacts: [],
    notes_for_next_agent: '',
    commit_message: message,
  }) as unknown as TEnvelopeBase

/**
 * Point this repository's commits at a hook that always refuses, the same
 * subprocess a signing agent that never unlocked fails in — without
 * touching signing, so the test is not at the mercy of the developer's own
 * gpg or 1Password configuration.
 */
const withFailingPreCommit = (dir: string): void => {
  const hooksDir = join(dir, '.hooks')
  mkdirSync(hooksDir, { recursive: true })
  const hook = join(hooksDir, 'pre-commit')
  writeFileSync(hook, '#!/bin/sh\necho "commit refused by hook" >&2\nexit 1\n')
  chmodSync(hook, 0o755)
  git(dir, 'config', 'core.hooksPath', hooksDir)
}

/** A commit shells out in the process's cwd, so the test stands there. */
const inRepo = <TResult>(dir: string, body: () => TResult): TResult => {
  const was = process.cwd()
  process.chdir(dir)
  try {
    return body()
  } finally {
    process.chdir(was)
  }
}

test.skipIf(SKIP_INTEGRATION)(
  [
    'given a refused commit with a multi-line message',
    'when the hook is removed and refused work is retried',
    'it should retain the whole message and answer the warning exactly once',
  ].join(', '),
  async () => {
    // given
    using fixture = deliveryFixture()
    const { run, dir } = fixture
    const message =
      'fix: complete the delivery\n\nPreserve this body, not only the subject.'
    const hook = await refuseBuildCommit(run, message)
    const refused = run.tracer.eventsNamed(run.runId, COMMIT_REFUSED_EVENT)
    expect(refused).toEqual([
      { activity: 'build', stage: 'implement', message },
    ])
    expect(outstandingCommits(run)[0]?.note).toContain('commit refused by hook')
    rmSync(hook)

    // when
    recommitRefused(run)
    recommitRefused(run)

    // then
    expect(gitIn(dir, 'log', '-1', '--pretty=%B')).toBe(message)
    expect(outstandingCommits(run)).toEqual([])
    const recovered = run.tracer
      .eventsNamed(run.runId, 'tree_warning')
      .filter((warning) => warning.kind === 'recovered')
    expect(recovered).toEqual([
      {
        kind: 'recovered',
        activities: ['build'],
        activity_run_ids: [
          run.tracer.activityRunsFor(run.runId)[0]?.activity_run_id,
        ],
        stage: 'implement',
        paths: ['work.txt'],
        note: `committed ${gitIn(dir, 'rev-parse', '--short', 'HEAD')}`,
      },
    ])
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given a commit whose hook still refuses at delivery',
    'when recommitRefused makes its one retry',
    'it should leave exactly one outstanding warning for the Activity and retain the staged paths',
  ].join(', '),
  async () => {
    // given
    using fixture = deliveryFixture()
    const { run, dir } = fixture
    await refuseBuildCommit(run)
    const head = gitIn(dir, 'rev-parse', 'HEAD')

    // when
    recommitRefused(run)

    // then
    expect(outstandingCommits(run)).toHaveLength(1)
    expect(
      run.tracer.eventsNamed(run.runId, COMMIT_REFUSED_EVENT),
    ).toHaveLength(2)
    expect(gitIn(dir, 'rev-parse', 'HEAD')).toBe(head)
    expect(gitIn(dir, 'diff', '--cached', '--name-only')).toBe('work.txt')
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given no refused commit in a real run',
    'when recommitRefused is called',
    'it should leave HEAD, the trace and the terminal unchanged',
  ].join(', '),
  () => {
    // given
    using fixture = deliveryFixture()
    const { run, dir } = fixture
    const head = gitIn(dir, 'rev-parse', 'HEAD')
    const output = terminalOutput()
    const empty = runIn({}, dir)

    // when
    recommitRefused(run)
    recommitRefused(empty)

    // then
    expect(gitIn(dir, 'rev-parse', 'HEAD')).toBe(head)
    expect(eventsOf(empty)).toEqual([])
    expect(terminalOutput()).toBe(output)
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given an Activity with no outstanding warning',
    'when its observed work is committed',
    'it should not invent a recovered warning',
  ].join(', '),
  () => {
    // given
    using fixture = deliveryFixture()
    writeFileSync(join(fixture.dir, 'work.txt'), 'after\n')
    const run = runIn({ build: ['work.txt'] }, fixture.dir)

    // when
    const sha = commitActivity(run, 'build', 'id_build', undefined, 'implement')

    // then
    expect(sha).not.toBe('')
    expect(
      eventsOf(run).filter((event) => event.name === 'tree_warning'),
    ).toEqual([])
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given a refused commit the operator subsequently committed by hand',
    'when commitActivity finds nothing left to commit',
    'it should answer the warning with an empty path list and the nothing-left note',
  ].join(', '),
  async () => {
    // given
    using fixture = deliveryFixture()
    const { run, dir } = fixture
    rmSync(await refuseBuildCommit(run))
    gitIn(dir, 'commit', '-qm', 'operator landed it', '--', 'work.txt')
    const id = run.tracer.activityRunsFor(run.runId)[0]?.activity_run_id ?? ''

    // when
    const actual = commitActivity(run, 'build', id, undefined, 'implement')

    // then
    expect(actual).toBe('')
    expect(outstandingCommits(run)).toEqual([])
    expect(
      run.tracer.eventsNamed(run.runId, 'tree_warning').at(-1),
    ).toMatchObject({
      kind: 'recovered',
      activities: ['build'],
      paths: [],
      note: 'nothing was left to commit',
    })
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given an older refusal without a commit_refused message event',
    'when recommitRefused lands the work',
    'it should use the run fallback message',
  ].join(', '),
  async () => {
    // given
    using fixture = deliveryFixture()
    const { run, dir } = fixture
    rmSync(await refuseBuildCommit(run))
    const legacy: TRun = {
      ...run,
      tracer: {
        ...run.tracer,
        eventsNamed: (id, name) =>
          name === COMMIT_REFUSED_EVENT ? [] : run.tracer.eventsNamed(id, name),
      },
    }

    // when
    recommitRefused(legacy)

    // then
    expect(gitIn(dir, 'log', '-1', '--pretty=%B')).toBe(
      commitMessage(run, undefined),
    )
    expect(outstandingCommits(run)).toEqual([])
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given distinct refused Activity instances in trace order',
    'when recommitRefused retries them',
    'it should commit each observed scope once with its own last full message',
  ].join(', '),
  () => {
    // given
    using fixture = deliveryFixture()
    const { dir } = fixture
    writeFileSync(join(dir, 'first.txt'), 'first\n')
    writeFileSync(join(dir, 'second.txt'), 'second\n')
    const run = runIn({ build: ['first.txt'], build_2: ['second.txt'] }, dir)
    withFailingPreCommit(dir)
    commitActivity(
      run,
      'build',
      'id_first',
      envelopeWith('fix: first\n\nFirst body.'),
      'one',
    )
    commitActivity(
      run,
      'build_2',
      'id_second',
      envelopeWith('fix: second\n\nSecond body.'),
      'two',
    )
    rmSync(join(dir, '.hooks', 'pre-commit'))

    // when
    recommitRefused(run)

    // then
    expect(outstandingCommits(run)).toEqual([])
    expect(gitIn(dir, 'log', '-2', '--pretty=%s').split('\n')).toEqual([
      'fix: second',
      'fix: first',
    ])
    expect(gitIn(dir, 'diff', '--name-only', 'HEAD~2', 'HEAD~1')).toBe(
      'first.txt',
    )
    expect(gitIn(dir, 'diff', '--name-only', 'HEAD~1', 'HEAD')).toBe(
      'second.txt',
    )
    expect(
      eventsOf(run).filter((event) => event.name === COMMIT_REFUSED_EVENT),
    ).toHaveLength(2)
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given issue #125 requirement 1.3.3 and two refused attempts for the same Activity',
    'when delivery retries after the hook is removed',
    'it should use the latest whole message and recover the latest refusal only once',
  ].join(', '),
  () => {
    // given
    using fixture = deliveryFixture()
    const { dir } = fixture
    writeFileSync(join(dir, 'work.txt'), 'completed work\n')
    const run = runIn({ build: ['work.txt'] }, dir)
    const firstMessage = 'fix: first attempt\n\nOriginal explanation.'
    const lastMessage =
      'fix: revised attempt\n\nKeep this replacement body.\n\nRefs: #125'
    withFailingPreCommit(dir)
    commitActivity(
      run,
      'build',
      'id_first',
      envelopeWith(firstMessage),
      'implement',
    )
    commitActivity(
      run,
      'build',
      'id_resumed',
      envelopeWith(lastMessage),
      'revise',
    )
    rmSync(join(dir, '.hooks', 'pre-commit'))

    // when
    recommitRefused(run)
    recommitRefused(run)

    // then
    expect(gitIn(dir, 'log', '-1', '--pretty=%B')).toBe(lastMessage)
    expect(gitIn(dir, 'rev-list', '--count', 'HEAD')).toBe('2')
    expect(outstandingCommits(run)).toEqual([])
    expect(
      run.tracer
        .eventsNamed(run.runId, 'tree_warning')
        .filter((warning) => warning.kind === 'recovered'),
    ).toEqual([
      {
        kind: 'recovered',
        activities: ['build'],
        activity_run_ids: ['id_resumed'],
        stage: 'revise',
        paths: ['work.txt'],
        note: `committed ${gitIn(dir, 'rev-parse', '--short', 'HEAD')}`,
      },
    ])
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given issue #125 requirement 1.3.3 and unrelated work the operator already staged',
    'when delivery retries the refused Activity commit',
    'it should commit only the observed paths and leave the operator work staged and intact',
  ].join(', '),
  () => {
    // given
    using fixture = deliveryFixture()
    const { dir } = fixture
    writeFileSync(join(dir, 'work.txt'), 'completed work\n')
    writeFileSync(join(dir, 'operator.txt'), 'unfinished operator work\n')
    gitIn(dir, 'add', '--', 'operator.txt')
    const run = runIn({ build: ['work.txt'] }, dir)
    withFailingPreCommit(dir)
    commitActivity(
      run,
      'build',
      'id_build',
      envelopeWith('fix: land only the Activity work'),
      'implement',
    )
    rmSync(join(dir, '.hooks', 'pre-commit'))

    // when
    recommitRefused(run)

    // then
    expect(gitIn(dir, 'diff', '--name-only', 'HEAD~1', 'HEAD')).toBe('work.txt')
    expect(gitIn(dir, 'diff', '--cached', '--name-only')).toBe('operator.txt')
    expect(gitIn(dir, 'show', ':operator.txt')).toBe('unfinished operator work')
    expect(gitIn(dir, 'show', 'HEAD:work.txt')).toBe('completed work')
    expect(outstandingCommits(run)).toEqual([])
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given use-cases/deliver::commitActivity',
    'when an Activity that declared commit has changed the tree',
    "it should commit it in the envelope's own words",
  ].join(', '),
  () => {
    // given
    /*
     * given — granularity follows the chain: several writing Activities
     * produce several commits, each in the words of the envelope that
     * wrote it, rather than one squashed `commitAll` at the end.
     */
    const dir = aRepo()
    writeFileSync(join(dir, 'README.md'), 'after\n')
    const run = runIn({ build: ['README.md'] }, dir)

    // when
    const actual = inRepo(dir, () =>
      commitActivity(
        run,
        'build',
        'id',
        envelopeWith('feat: the thing'),
        'implement',
      ),
    )

    // then
    expect(actual).not.toEqual('')
    expect(git(dir, 'log', '-1', '--pretty=%s')).toEqual('feat: the thing')
    expect(
      eventsOf(run).find((event) => event.name === 'committed')?.payload,
    ).toMatchObject({ paths: ['README.md'] })
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given use-cases/deliver::commitActivity',
    'when the tree holds a change no Activity was observed to make',
    'it should leave it alone, because it is not this run’s to commit',
  ].join(', '),
  () => {
    // given
    /*
     * given — the developer is working in the same branch, which is a
     * supported way to use this tool. `git add -A` swept their file into
     * the first Activity that declared `commit: true`, under a message
     * describing something else.
     */
    const dir = aRepo()
    writeFileSync(join(dir, 'README.md'), 'mine, in progress\n')
    writeFileSync(join(dir, 'src.ts'), 'built here\n')

    // when
    const actual = inRepo(dir, () =>
      commitActivity(
        runIn({ build: ['src.ts'] }, dir),
        'build',
        'id',
        envelopeWith('feat: the thing'),
        'implement',
      ),
    )

    // then — one file in the commit, the other still dirty and untouched
    expect(actual).not.toEqual('')
    expect(git(dir, 'show', '--name-only', '--pretty=format:', 'HEAD')).toEqual(
      'src.ts',
    )
    expect(git(dir, 'status', '--porcelain')).toContain('README.md')
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given use-cases/deliver::commitActivity',
    'when the Activity changed no tracked file',
    'it should commit nothing rather than fail on an empty change',
  ].join(', '),
  () => {
    // given — an Activity whose gates passed without touching the repo has
    // done its job; demanding a commit would make that an error
    const dir = aRepo()

    // when
    const actual = inRepo(dir, () =>
      commitActivity(
        runIn({}, dir),
        'review',
        'id',
        envelopeWith('chore: nothing'),
        'review',
      ),
    )

    // then
    expect(actual).toEqual('')
    expect(git(dir, 'log', '--oneline')).not.toContain('chore: nothing')
  },
)

test(
  [
    'given use-cases/deliver::commitMessage',
    'when the envelope that wrote the code supplied no subject',
    'it should fall back to something traceable to the run',
  ].join(', '),
  () => {
    // given
    const given = envelopeWith('')

    // when
    const actual = commitMessage(runIn(), given)

    // then
    expect(actual).toEqual('crust(aaaa1111): implemented the thing')
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given use-cases/deliver::commitActivity',
    'when git refuses the commit — a hook exiting non-zero, standing in for an unlocked signing agent',
    "it should return '' and never throw out of the Activity Run",
  ].join(', '),
  () => {
    // given — the work is done; only the commit itself fails
    const dir = aRepo()
    writeFileSync(join(dir, 'README.md'), 'after\n')
    withFailingPreCommit(dir)
    const run = runIn({ build: ['README.md'] }, dir)

    // when
    const actual = inRepo(dir, () =>
      commitActivity(
        run,
        'build',
        'id',
        envelopeWith('feat: the thing'),
        'implement',
      ),
    )

    // then — no throw reached the caller, and HEAD never moved
    expect(actual).toEqual('')
    expect(git(dir, 'log', '--oneline').split('\n')).toHaveLength(1)
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given use-cases/deliver::commitActivity',
    'when git refuses the commit',
    'it should file a tree_warning of kind uncommitted naming the touched paths',
  ].join(', '),
  () => {
    // given
    const dir = aRepo()
    writeFileSync(join(dir, 'README.md'), 'after\n')
    withFailingPreCommit(dir)
    const run = runIn({ build: ['README.md'] }, dir)

    // when
    inRepo(dir, () =>
      commitActivity(
        run,
        'build',
        'id',
        envelopeWith('feat: the thing'),
        'implement',
      ),
    )

    // then
    const filed = eventsOf(run).find((event) => event.name === 'tree_warning')
    expect(filed?.payload).toMatchObject({
      kind: 'uncommitted',
      activities: ['build'],
      paths: ['README.md'],
    })
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given use-cases/deliver::commitActivity',
    'when git refuses the commit',
    'it should leave the working tree exactly as git left it — no reset, no unstage',
  ].join(', '),
  () => {
    // given
    const dir = aRepo()
    writeFileSync(join(dir, 'README.md'), 'after\n')
    withFailingPreCommit(dir)
    const run = runIn({ build: ['README.md'] }, dir)

    // when
    inRepo(dir, () =>
      commitActivity(
        run,
        'build',
        'id',
        envelopeWith('feat: the thing'),
        'implement',
      ),
    )

    // then — `git add` already staged it before the hook refused
    expect(git(dir, 'status', '--porcelain')).toContain('README.md')
  },
)
