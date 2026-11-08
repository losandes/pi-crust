import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { basename } from 'node:path'
import {
  restoreTerminal,
  silenceTerminal,
} from '../../../../testing/terminal-capture'
import { sessionLifecycle } from './start-session'

beforeEach(silenceTerminal)
afterEach(restoreTerminal)

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
    /*
     * given — nearly every run goes through `compose.ts`, so the script name
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
    // given
    const given = ''

    // when
    const actual = sessionLifecycle(given)

    // then
    expect(actual).toEqual(scriptName())
  },
)

import { existsSync, mkdtempSync, rmSync } from 'node:fs'
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
  /*
   * `startSession` registers the working tree in `~/.pi-crust/workspaces.jsonl`
   * on every call. Pointed at a scratch file instead, so running this suite
   * never appends a tmp-directory entry to the developer's real registry.
   */
  // biome-ignore lint/plugin/no-object-mutation: process.env is the external API startSession reads, and this fixture is the adapter that owns the assignment
  process.env.CRUST_REGISTRY = join(dir, 'workspaces.jsonl')
  return crustConfigSchema.parse({
    defaults: { data_dir: dataDir },
    observability: { db: join(dataDir, 'crust.db') },
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
    // given
    const cfg = scratchConfig()

    // when
    const run = startSession(cfg, 'a1b2c3d4')

    // then
    const expected = defaultHandoffDir(cfg.defaults.data_dir, 'a1b2c3d4')
    expect(run.contextHandoffDir).toEqual(expected)
    expect(
      recordedHandoffDir(join(cfg.defaults.data_dir, 'sessions', 'a1b2c3d4')),
    ).toEqual(expected)
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
    // given
    const cfg = scratchConfig()

    // when
    const run = startSession(cfg, 'a1b2c3d4', { handoff: 'specs/{session_id}' })

    // then
    const expected = resolve(repoRoot(), 'specs', 'a1b2c3d4')
    expect(run.contextHandoffDir).toEqual(expected)
    expect(existsSync(expected)).toBe(true)
    expect(
      recordedHandoffDir(join(cfg.defaults.data_dir, 'sessions', 'a1b2c3d4')),
    ).toEqual(expected)
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
    // given, when
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
    'it should refuse, naming `just crust procs`',
  ].join(', '),
  () => {
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
    expect(actual.reason).toContain('just crust procs')
  },
)

test(
  [
    'given use-cases/start-session::resumeVerdict',
    "when the status is 'running' but no process answers",
    'it should allow the resume \u2014 a run that was SIGKILLed never closed its own rows',
  ].join(', '),
  () => {
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
