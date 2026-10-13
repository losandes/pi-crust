import { expect, test } from 'bun:test'
import { basename } from 'node:path'
import { sessionLifecycle } from './start-session'

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
import { repoRoot } from '../data/git'
import { recordedHandoffDir } from '../data/handoff-pointer'
import { crustConfigSchema } from '../typedefs/config'
import { defaultHandoffDir } from './handoff-location'
import { startSession } from './start-session'

const scratchConfig = () => {
  const dir = mkdtempSync(join(tmpdir(), 'crust-start-session-'))
  const dataDir = join(dir, 'data')
  /*
   * `startSession` registers the working tree in `~/.pi-crust/workspaces.jsonl`
   * on every call. Pointed at a scratch file instead, so running this suite
   * never appends a tmp-directory entry to the developer's real registry.
   */
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
    'when a resumed run\'s --handoff resolves to a directory other than the one it recorded',
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
