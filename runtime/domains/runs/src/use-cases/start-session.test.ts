import { expect, spyOn, test } from 'bun:test'
import { basename } from 'node:path'
import {
  restoreTerminal,
  silenceTerminal,
} from '../../../../testing/terminal-capture'
import { sessionLifecycle } from './start-session'

const captureTerminal = () => {
  silenceTerminal()
  return { [Symbol.dispose]: restoreTerminal }
}

/** What the fallback resolves to in whatever process is running the suite. */
const scriptName = (): string =>
  basename(process.argv[1] ?? 'crust').replace(/\.ts$/, '')

test(
  [
    'given use-cases/start-session::sessionLifecycle',
    'when the run was asked for a Lifecycle by name',
    'it should record that name, not the script that happened to run it',
  ].join(', '),
  () => {
    using _terminal = captureTerminal()
    // given
    /*
     * nearly every run goes through `compose.ts`, so the script name
     * made `sdlc`, `tdd` and `bugfix` all read as `compose` on the dashboard:
     * one word for every run, naming the mechanism rather than the work.
     */
    const given = 'sdlc'

    // when
    const actual = sessionLifecycle(given)

    // then
    expect(actual).toEqual('sdlc')
  },
)

test(
  [
    'given use-cases/start-session::sessionLifecycle',
    'when the chain was spelled out at the call site instead of named',
    'it should fall back to the script name, because there is no name to give',
  ].join(', '),
  () => {
    using _terminal = captureTerminal()
    // given — `--activities plan,build` names no Lifecycle
    const given = undefined

    // when
    const actual = sessionLifecycle(given)

    // then
    expect(actual).toEqual(scriptName())
  },
)

test(
  [
    'given use-cases/start-session::sessionLifecycle',
    'when the flag was present but empty',
    'it should read as no Lifecycle rather than record a blank name',
  ].join(', '),
  () => {
    using _terminal = captureTerminal()
    // given
    const given = ''

    // when
    const actual = sessionLifecycle(given)

    // then
    expect(actual).toEqual(scriptName())
  },
)

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { TRunState } from '../../../../lib/contracts'
import { activityRunParams, crustConfigSchema } from '../../../../lib/contracts'
import { terminalOutput } from '../../../../testing/terminal-capture'
import { defaultHandoffDir, recordedHandoffDir } from '../../../handoff'
import { repoRoot } from '../../../workspace'
import { freshSessionId, resumeVerdict, startSession } from './start-session'

const stateWith = (
  overrides: Partial<Pick<TRunState, 'status' | 'resume_from' | 'resumable'>>,
): TRunState =>
  ({
    run_id: 'fbf49583',
    lifecycle: 'ship',
    name: '',
    request: '',
    status: 'fail',
    engineer: 'tester',
    started_at: undefined,
    ended_at: undefined,
    tokens: 0,
    cost: 0,
    activityRuns: [],
    completed: [],
    resume_from: undefined,
    resumable: true,
    failed_gates: [],
    warnings: [],
    envelopes: [],
    ...overrides,
  }) as TRunState

const scratchConfig = () => {
  const dir = mkdtempSync(join(tmpdir(), 'crust-start-session-'))
  const dataDir = join(dir, 'data')
  return crustConfigSchema.parse({
    defaults: { data_dir: dataDir },
    observability: {},
    agents: [],
  })
}

test(
  [
    'given use-cases/start-session::startSession',
    'when no --handoff was given',
    'it should land on the canonical directory and record it in the pointer',
  ].join(', '),
  () => {
    using _terminal = captureTerminal()
    // given
    const cfg = scratchConfig()

    // when
    const run = startSession(cfg, 'a1b2c3d4')

    // then
    const expected = defaultHandoffDir(run.sessionDir)
    expect(run.contextHandoffDir).toEqual(expected)
    expect(recordedHandoffDir(run.sessionDir)).toEqual(expected)
    run.tracer.close()
  },
)

test(
  [
    'given use-cases/start-session::startSession',
    'when --handoff specs/{session_id} was given',
    'it should land on <repo>/specs/<runId> and record exactly that',
  ].join(', '),
  () => {
    using _terminal = captureTerminal()
    // given
    const cfg = scratchConfig()

    // when
    const run = startSession(cfg, 'a1b2c3d4', { handoff: 'specs/{session_id}' })

    // then
    const expected = resolve(repoRoot(), 'specs', 'a1b2c3d4')
    expect(run.contextHandoffDir).toEqual(expected)
    expect(existsSync(expected)).toBe(true)
    expect(recordedHandoffDir(run.sessionDir)).toEqual(expected)
    run.tracer.close()
    rmSync(expected, { recursive: true, force: true })
  },
)

test(
  [
    'given use-cases/start-session::startSession',
    "when a resumed run's --handoff resolves to a directory other than the one it recorded",
    'it should throw, naming both directories, before any agent runs',
  ].join(', '),
  () => {
    using _terminal = captureTerminal()
    // given — a run that started, recorded a pointer, then stopped for a gate
    const cfg = scratchConfig()
    const first = startSession(cfg, 'a1b2c3d4')
    first.tracer.sessionWaiting('a1b2c3d4')
    first.tracer.close()

    // when, then
    expect(() =>
      startSession(cfg, 'a1b2c3d4', {
        resume: true,
        handoff: 'specs/{session_id}',
      }),
    ).toThrow(/already recorded/)
  },
)

test(
  [
    'given use-cases/start-session::startSession',
    'when no --run-id was given at all',
    'it should mint a fresh one itself',
  ].join(', '),
  () => {
    using _terminal = captureTerminal()
    // given
    const cfg = scratchConfig()

    // when
    const run = startSession(cfg)

    // then
    expect(run.runId.length).toBeGreaterThan(0)
    run.tracer.close()
  },
)

test(
  [
    'given use-cases/start-session::startSession',
    'when the process receives SIGTERM after a session has started',
    "it should close the session's own trace before exiting, rather than leave it reading running forever",
  ].join(', '),
  () => {
    using _terminal = captureTerminal()
    // given — every signal listener any earlier startSession() in this file
    // left behind is removed first, so only this call's own fires
    process.removeAllListeners('SIGTERM')
    process.removeAllListeners('SIGINT')
    const cfg = scratchConfig()
    startSession(cfg, 'a1b2c3d4')
    const exitSpy = spyOn(process, 'exit').mockImplementation(
      (() => undefined) as never,
    )

    try {
      // when — the same signal finalizeWhenKilled listens for
      process.emit('SIGTERM')
    } finally {
      exitSpy.mockRestore()
      process.removeAllListeners('SIGTERM')
      process.removeAllListeners('SIGINT')
    }

    // then — the session no longer reads 'running'
    const resumed = startSession(cfg, 'a1b2c3d4', { resume: true })
    expect(resumed).toBeDefined()
    resumed.tracer.close()
  },
)

test(
  [
    'given use-cases/start-session::startSession',
    'when --resume is given with no --run-id at all',
    'it should throw, naming what to do instead, before touching a database',
  ].join(', '),
  () => {
    using _terminal = captureTerminal()
    // given
    const cfg = scratchConfig()

    // when, then
    expect(() => startSession(cfg, undefined, { resume: true })).toThrow(
      /--resume needs --run-id/,
    )
  },
)

test(
  [
    'given use-cases/start-session::startSession',
    'when --resume picks up a session with a completed activityRun',
    'it should carry the completed set through and note how many it skipped',
  ].join(', '),
  () => {
    using _terminal = captureTerminal()
    // given — a run that finished one activityRun, then stopped (a gate, say)
    const cfg = scratchConfig()
    const first = startSession(cfg, 'a1b2c3d4')
    first.tracer.activityRunUpsert({
      activity_run_id: 'a1b2c3d4_01_build',
      run_id: 'a1b2c3d4',
      seq: 1,
      params: activityRunParams({
        name: 'build',
        kind: 'code',
        owner: 'quality',
        description: 'the piece this resume should skip',
      }),
      status: 'success',
      error: undefined,
      started_at: '2024-01-01T00:00:00.000Z',
      ended_at: '2024-01-01T00:00:01.000Z',
    })
    first.tracer.sessionFinish('a1b2c3d4', false)
    first.tracer.close()

    // when
    const resumed = startSession(cfg, 'a1b2c3d4', { resume: true })

    // then
    expect(resumed.resume.has('build')).toBe(true)
    expect(terminalOutput()).toContain('resuming: 1 activityRun(s)')
    resumed.tracer.close()
  },
)

test(
  [
    'given use-cases/start-session::startSession',
    'when --handoff names a directory that carries no run id',
    'it should note that the directory is shared with any other run pointed at it',
  ].join(', '),
  () => {
    using _terminal = captureTerminal()
    // given — a handoff literal with no {session_id} placeholder
    const cfg = scratchConfig()

    // when
    const run = startSession(cfg, 'a1b2c3d4', { handoff: 'specs/shared' })

    // then
    expect(terminalOutput()).toContain('carries no run id')
    run.tracer.close()
    rmSync(resolve(repoRoot(), 'specs', 'shared'), {
      recursive: true,
      force: true,
    })
  },
)

test(
  [
    'given use-cases/start-session::resumeVerdict',
    'when there is no such session',
    'it should refuse',
  ].join(', '),
  () => {
    using _terminal = captureTerminal()
    // given
    // when
    const actual = resumeVerdict(undefined, 'fbf49583', false)

    // then
    expect(actual.ok).toBe(false)
  },
)

test(
  [
    'given use-cases/start-session::resumeVerdict',
    "when the status is 'fail' and every RECORDED Activity Run was green",
    'it should allow the resume \u2014 the exact state run fbf49583 died in',
  ].join(', '),
  () => {
    using _terminal = captureTerminal()
    // given
    const given = stateWith({
      status: 'fail',
      resume_from: undefined,
      resumable: true,
    })

    // when
    const actual = resumeVerdict(given, 'fbf49583', false)

    // then
    expect(actual).toEqual({ ok: true, reason: '' })
  },
)

test(
  [
    'given use-cases/start-session::resumeVerdict',
    "when the status is 'success'",
    'it should refuse, saying the run finished successfully',
  ].join(', '),
  () => {
    using _terminal = captureTerminal()
    // given
    const given = stateWith({
      status: 'success',
      resume_from: undefined,
      resumable: false,
    })

    // when
    const actual = resumeVerdict(given, 'fbf49583', false)

    // then
    expect(actual.ok).toBe(false)
    expect(actual.reason).toContain('finished successfully')
  },
)

test(
  [
    'given use-cases/start-session::resumeVerdict',
    "when the status is 'waiting'",
    'it should allow the resume',
  ].join(', '),
  () => {
    using _terminal = captureTerminal()
    // given \u2014 the thing it was waiting for was a person, who has now answered
    const given = stateWith({
      status: 'waiting',
      resume_from: undefined,
      resumable: true,
    })

    // when
    const actual = resumeVerdict(given, 'fbf49583', false)

    // then
    expect(actual).toEqual({ ok: true, reason: '' })
  },
)

test(
  [
    'given use-cases/start-session::resumeVerdict',
    "when the status is 'running' and a process is still alive",
    'it should refuse, naming `crust procs`',
  ].join(', '),
  () => {
    using _terminal = captureTerminal()
    // given
    const given = stateWith({
      status: 'running',
      resume_from: 'build',
      resumable: true,
    })

    // when
    const actual = resumeVerdict(given, 'fbf49583', true)

    // then
    expect(actual.ok).toBe(false)
    expect(actual.reason).toContain('crust procs')
  },
)

test(
  [
    'given use-cases/start-session::resumeVerdict',
    "when the status is 'running' but no process answers",
    'it should allow the resume \u2014 a run that was SIGKILLed never closed its own rows',
  ].join(', '),
  () => {
    using _terminal = captureTerminal()
    // given
    const given = stateWith({
      status: 'running',
      resume_from: 'build',
      resumable: true,
    })

    // when
    const actual = resumeVerdict(given, 'fbf49583', false)

    // then
    expect(actual).toEqual({ ok: true, reason: '' })
  },
)

test(
  [
    'given use-cases/start-session::freshSessionId',
    'when the first minted id is already taken',
    'it should retry rather than hand back an id whose directory already exists (1.4.2)',
  ].join(', '),
  () => {
    using _terminal = captureTerminal()
    // given — a pooled store that already holds 'aaaa1111'
    const minted = ['aaaa1111', 'bbbb2222']
    let mintCalls = 0
    const mint = () => {
      const candidate = minted.at(mintCalls) as string
      mintCalls += 1
      return candidate
    }
    const taken = (candidate: string) => candidate === 'aaaa1111'

    // when
    const actual = freshSessionId(mint, taken)

    // then
    expect(actual).toEqual('bbbb2222')
  },
)

test(
  [
    'given use-cases/start-session::freshSessionId',
    'when the first minted id is free',
    'it should use it without minting a second one',
  ].join(', '),
  () => {
    using _terminal = captureTerminal()
    // given
    let calls = 0
    const mint = () => {
      calls += 1
      return 'free0000'
    }
    const taken = () => false

    // when
    const actual = freshSessionId(mint, taken)

    // then
    expect(actual).toEqual('free0000')
    expect(calls).toEqual(1)
  },
)

// Integration proves both the shared shipped default and the distinction between repository and worktree.
test.skipIf(
  !process.env.RUN_INTEGRATION_TESTS ||
    process.env.RUN_INTEGRATION_TESTS === 'false',
)(
  [
    'given two repositories and a linked worktree with a scratch machine home',
    'when runs start with the shipped data default',
    'it should leave the workspaces unchanged and record one repository identity per clone',
  ].join(', '),
  async () => {
    using _terminal = captureTerminal()
    // given
    const { execFileSync } = await import('node:child_process')
    const { Database } = await import('bun:sqlite')
    const scratch = realpathSync(
      mkdtempSync(join(tmpdir(), 'crust-shared-origin-')),
    )
    const primary = join(scratch, 'primary')
    const other = join(scratch, 'other')
    const linked = join(scratch, 'linked')
    const home = join(scratch, 'user')
    const git = (cwd: string, ...args: string[]) =>
      execFileSync('git', args, { cwd, stdio: 'pipe' })
    for (const root of [primary, other]) {
      mkdirSync(root)
      git(root, 'init', '-q', '-b', 'main')
      git(
        root,
        '-c',
        'user.name=tester',
        '-c',
        'user.email=tester@example.com',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--allow-empty',
        '-qm',
        'fixture',
      )
    }
    git(primary, 'worktree', 'add', '-qb', 'linked', linked)
    const roots = [primary, linked, other]
    const before = roots.map((root) =>
      readdirSync(root, { recursive: true }).map(String).toSorted(),
    )
    const entry = join(import.meta.dir, 'start-session.ts')
    const loader = join(import.meta.dir, '../../../config/index.ts')
    const packageConfig = resolve(import.meta.dir, '../../../../config')
    const empty = resolve(
      import.meta.dir,
      '../../../../testing/empty-repository.toml',
    )
    try {
      // when
      for (const [index, root] of roots.entries()) {
        const code = `import { startSession } from ${JSON.stringify(entry)}; import { loadConfigWithNotes } from ${JSON.stringify(loader)}; const run = startSession(loadConfigWithNotes(${JSON.stringify(empty)}).config, 'origin' + ${index}); run.tracer.sessionFinish(run.runId, true); run.tracer.close()`
        const result = Bun.spawnSync(['bun', '-e', code], {
          cwd: root,
          env: {
            ...process.env,
            HOME: home,
            CRUST_DATA_DIR: '',
            CRUST_PACKAGE_CONFIG: packageConfig,
            CRUST_MACHINE_CONFIG: join(home, 'absent-config'),
          },
          stdout: 'pipe',
          stderr: 'pipe',
        })
        expect(new TextDecoder().decode(result.stderr)).toBe('')
        expect(result.exitCode).toBe(0)
      }
      // then
      expect(
        roots.map((root) =>
          readdirSync(root, { recursive: true }).map(String).toSorted(),
        ),
      ).toEqual(before)
      const db = new Database(join(home, '.pi-crust/data/crust.db'), {
        readonly: true,
      })
      expect(
        db
          .query(
            'SELECT repository_root, workspace_root FROM sessions ORDER BY run_id',
          )
          .all(),
      ).toEqual([
        { repository_root: primary, workspace_root: primary },
        { repository_root: primary, workspace_root: linked },
        { repository_root: other, workspace_root: other },
      ])
      db.close()
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  },
  20_000,
)

const SKIP_PLACEMENT_INTEGRATION =
  !process.env.RUN_INTEGRATION_TESTS ||
  process.env.RUN_INTEGRATION_TESTS === 'false'

const placementFixture = async (withLinked = false) => {
  const { spawnSync } = await import('node:child_process')
  const { registeredRepositoryPath, runIdTaken, sessionsDirIn } = await import(
    '../../../../../lib/run-directories'
  )
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'crust-placement-')))
  const primary = join(root, 'notes')
  const linked = join(root, 'linked')
  const dataDir = join(root, 'data')
  const dbPath = join(dataDir, 'crust.db')
  const store = { dbPath, sessionsDir: sessionsDirIn(dataDir) }
  mkdirSync(primary)
  const git = (...args: string[]) =>
    expect(spawnSync('git', ['-C', primary, ...args]).status).toBe(0)
  git('init')
  git(
    '-c',
    'user.name=tester',
    '-c',
    'user.email=test@example.com',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--allow-empty',
    '-m',
    'fixture',
  )
  if (withLinked) git('worktree', 'add', '-b', 'linked', linked)
  const entry = join(import.meta.dir, 'start-session.ts')
  const contracts = resolve(
    import.meta.dir,
    '../../../../lib/contracts/index.ts',
  )
  const start = (cwd: string, id?: string) => {
    const code = `import {startSession} from ${JSON.stringify(entry)}; import {crustConfigSchema} from ${JSON.stringify(contracts)}; const cfg = crustConfigSchema.parse({defaults:{data_dir:${JSON.stringify(dataDir)}},observability:{},agents:[]}); const run=startSession(cfg, ${JSON.stringify(id)}); run.tracer.sessionFinish(run.runId,true); run.tracer.close(); console.log(JSON.stringify({id:run.runId, dir:run.sessionDir}))`
    return spawnSync('bun', ['-e', code], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, CRUST_DATA_DIR: dataDir, CRUST_DB: dbPath },
    })
  }
  const successful = (
    cwd: string,
    id?: string,
  ): { id: string; dir: string } => {
    const result = start(cwd, id)
    expect(result.status, result.stderr).toBe(0)
    return JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '{}')
  }
  return {
    primary,
    linked,
    store,
    git,
    start,
    successful,
    registered: registeredRepositoryPath(store),
    taken: runIdTaken(store),
    [Symbol.dispose]: () => rmSync(root, { recursive: true, force: true }),
  }
}

test.skipIf(SKIP_PLACEMENT_INTEGRATION)(
  [
    'given an origin with a nested owner',
    'when starting a run',
    'it should place every run file beneath that repository path',
  ].join(', '),
  async () => {
    // given
    using fixture = await placementFixture()
    fixture.git(
      'remote',
      'add',
      'origin',
      'git@gitlab.example.com:group/subgroup/project.git',
    )

    // when
    const run = fixture.successful(fixture.primary, 'origin01')

    // then
    expect(run.dir).toBe(
      join(fixture.store.sessionsDir, 'group', 'subgroup', 'project', run.id),
    )
    for (const file of [
      'events.jsonl',
      'handoff-dir',
      'invocation.json',
      'context_handoff',
    ])
      expect(existsSync(join(run.dir, file))).toBe(true)
    expect(existsSync(join(fixture.store.sessionsDir, run.id))).toBe(false)
  },
)

test.skipIf(SKIP_PLACEMENT_INTEGRATION)(
  [
    'given an origin repository with a run and a linked worktree',
    'when starting a run in the linked worktree',
    'it should land beside the primary clone run',
  ].join(', '),
  async () => {
    // given
    using fixture = await placementFixture(true)
    fixture.git(
      'remote',
      'add',
      'origin',
      'git@gitlab.example.com:group/subgroup/project.git',
    )
    const primary = fixture.successful(fixture.primary, 'origin01')

    // when
    const linked = fixture.successful(fixture.linked, 'origin02')

    // then
    expect(linked.dir).toBe(join(primary.dir, '..', linked.id))
  },
)

test.skipIf(SKIP_PLACEMENT_INTEGRATION)(
  [
    'given a registered run whose origin has changed',
    'when starting with its pinned id',
    'it should keep the recorded directory',
  ].join(', '),
  async () => {
    // given
    using fixture = await placementFixture()
    fixture.git(
      'remote',
      'add',
      'origin',
      'git@gitlab.example.com:group/subgroup/project.git',
    )
    const first = fixture.successful(fixture.primary, 'origin01')
    fixture.git(
      'remote',
      'set-url',
      'origin',
      'git@github.com:changed/name.git',
    )

    // when
    const joined = fixture.successful(fixture.primary, first.id)

    // then
    expect(joined.dir).toBe(first.dir)
  },
)

test.skipIf(SKIP_PLACEMENT_INTEGRATION)(
  [
    'given an existing flat run directory',
    'when starting with its pinned id',
    'it should join in place without registering a repository path',
  ].join(', '),
  async () => {
    // given
    using fixture = await placementFixture()
    const { writeFileSync, readFileSync } = await import('node:fs')
    const flat = join(fixture.store.sessionsDir, 'legacy01')
    mkdirSync(flat, { recursive: true })
    writeFileSync(join(flat, 'keep'), 'legacy')

    // when
    const joined = fixture.successful(fixture.primary, 'legacy01')
    const registered = fixture.registered('legacy01')

    // then
    expect(joined.dir).toBe(flat)
    expect(registered).toBeUndefined()
    expect(readFileSync(join(flat, 'keep'), 'utf8')).toBe('legacy')
  },
)

test.skipIf(SKIP_PLACEMENT_INTEGRATION)(
  [
    'given a primary clone named notes with no origin',
    'when starting an unpinned run',
    'it should use the stable local name-and-hash directory',
  ].join(', '),
  async () => {
    // given
    using fixture = await placementFixture()

    // when
    const run = fixture.successful(fixture.primary)

    // then
    expect(run.dir).toMatch(/\/local\/notes-[a-f0-9]{8}\//)
  },
)

test.skipIf(SKIP_PLACEMENT_INTEGRATION)(
  [
    'given a local repository with a run and a linked worktree',
    'when starting an unpinned run in the linked worktree',
    'it should share the primary clone local directory',
  ].join(', '),
  async () => {
    // given
    using fixture = await placementFixture(true)
    const primary = fixture.successful(fixture.primary)

    // when
    const linked = fixture.successful(fixture.linked)

    // then
    expect(join(primary.dir, '..')).toBe(join(linked.dir, '..'))
  },
)

test.skipIf(SKIP_PLACEMENT_INTEGRATION)(
  [
    'given a registered id and a flat id offered before an available id',
    'when minting a fresh session id against the store',
    'it should skip both occupied ids',
  ].join(', '),
  async () => {
    // given
    using fixture = await placementFixture()
    const registered = fixture.successful(fixture.primary, 'origin01')
    mkdirSync(join(fixture.store.sessionsDir, 'legacy01'))
    const offered = (function* () {
      yield registered.id
      yield 'legacy01'
      return 'available'
    })()

    // when
    const actual = freshSessionId(() => offered.next().value, fixture.taken)

    // then
    expect(actual).toBe('available')
  },
)

test.skipIf(SKIP_PLACEMENT_INTEGRATION)(
  [
    'given an origin owner matching an earlier flat run id',
    'when starting a new run in that repository',
    'it should refuse without changing the earlier run directory',
  ].join(', '),
  async () => {
    // given
    using fixture = await placementFixture()
    const { writeFileSync } = await import('node:fs')
    const flat = join(fixture.store.sessionsDir, 'legacy01')
    mkdirSync(flat, { recursive: true })
    writeFileSync(join(flat, 'keep'), 'legacy')
    fixture.successful(fixture.primary, 'legacy01')
    const before = readdirSync(flat, { recursive: true })
    fixture.git('remote', 'add', 'origin', 'git@github.com:legacy01/tools.git')

    // when
    const refused = fixture.start(fixture.primary, 'refused1')
    const registered = fixture.registered('refused1')
    const after = readdirSync(flat, { recursive: true })

    // then
    expect(refused.status).not.toBe(0)
    expect(refused.stderr).toContain('belongs to run')
    expect(after).toEqual(before)
    expect(registered).toBeUndefined()
  },
)
