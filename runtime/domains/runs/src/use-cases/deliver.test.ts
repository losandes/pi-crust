import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TEnvelopeBase, TRun } from '../../../../lib/contracts'
import { observedPayload, PATHS_TOUCHED } from '../../../policy'
import { commitActivity, commitMessage } from './deliver'

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
          : [],
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

test(
  [
    'given use-cases/deliver::commitActivity',
    'when an Activity that declared commit has changed the tree',
    "it should commit it in the envelope's own words",
  ].join(', '),
  () => {
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

test(
  [
    'given use-cases/deliver::commitActivity',
    'when the tree holds a change no Activity was observed to make',
    'it should leave it alone, because it is not this run’s to commit',
  ].join(', '),
  () => {
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

test(
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

test(
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

test(
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

test(
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
