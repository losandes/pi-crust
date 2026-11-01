import { expect, spyOn, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTracer } from '../data/trace-db'
import { crustConfigSchema } from '../typedefs/config'
import type { TTracer } from '../typedefs/trace'
import { createRun } from './create-run'
import { createConsole } from './report-to-console'
import { startSession } from './start-session'

/*
 * https://github.com/losandes/pi-crust/issues/57 — the runtime test suite
 * printed CLI banners, boxes and prompt dumps to the real console as a side
 * effect of exercising `createConsole`, `createRun` and `startSession`.
 *
 * `report-to-console.test.ts`, `create-run.test.ts`, `run-activity-run.test.ts`,
 * `resume.test.ts` and `run-units.test.ts` go quiet by passing a no-op
 * `write` into these three functions. None of those files proves that the
 * mechanism itself — a `write` seam that defaults to the real terminal and
 * is overridable by a test — actually stops `process.stdout.write` from
 * being called, or that a caller who supplies nothing still gets the real
 * terminal (the thing every production CLI entry point depends on). These
 * tests exercise the seam directly, independent of any one caller's choice
 * to use it.
 */

/** A tracer that records nothing; only `process.stdout` matters here. */
const silentTracer = (): TTracer =>
  ({ event: () => '' }) as unknown as TTracer

test(
  [
    'given use-cases/report-to-console::createConsole',
    'when no write function is supplied',
    'it should still print through the real process.stdout.write, because that is the only reason a real pi-crust invocation prints anything',
  ].join(', '),
  () => {
    // given
    const stdout = spyOn(process.stdout, 'write').mockImplementation(
      () => true,
    )
    const console_ = createConsole(silentTracer(), 'aaaa1111')

    // when
    console_.sessionStarted('aaaa1111', 'tester', '/repo', '/repo')

    // then
    expect(stdout).toHaveBeenCalled()
    stdout.mockRestore()
  },
)

test(
  [
    'given use-cases/report-to-console::createConsole',
    'when a write function is supplied',
    'it should never call process.stdout.write, and should hand the rendered line to the supplied function instead',
  ].join(', '),
  () => {
    // given
    const stdout = spyOn(process.stdout, 'write').mockImplementation(
      () => true,
    )
    const written: string[] = []
    const console_ = createConsole(silentTracer(), 'aaaa1111', (text) => {
      // biome-ignore lint/plugin/no-array-mutation: recording what was written is the test
      written.push(text)
    })

    // when
    console_.sessionStarted('aaaa1111', 'tester', '/repo', '/repo')

    // then
    expect(stdout).not.toHaveBeenCalled()
    expect(written.length).toBeGreaterThan(0)
    stdout.mockRestore()
  },
)

test(
  [
    'given use-cases/create-run::createRun',
    'when no write is passed in params',
    'it should wire run.console to the real terminal, preserving production behaviour',
  ].join(', '),
  () => {
    // given
    const workspace = mkdtempSync(join(tmpdir(), 'crust-write-injection-'))
    execFileSync('git', ['init', '-q'], { cwd: workspace })
    mkdirSync(join(workspace, '.pi-crust'), { recursive: true })
    const tracer = createTracer(
      join(workspace, 'crust.db'),
      join(workspace, 'events.jsonl'),
    )
    const stdout = spyOn(process.stdout, 'write').mockImplementation(
      () => true,
    )

    // when
    const run = createRun({
      cfg: crustConfigSchema.parse({
        defaults: { data_dir: join(workspace, '.pi-crust', 'data') },
        observability: { db: join(workspace, 'crust.db') },
        agents: [],
      }),
      runId: 'aaaa1111',
      tracer,
      engineer: 'tester',
    })
    run.console.sessionStarted('aaaa1111', 'tester', workspace, workspace)

    // then
    expect(stdout).toHaveBeenCalled()
    stdout.mockRestore()
    run.tracer.close()
  },
)

test(
  [
    'given use-cases/create-run::createRun',
    'when a write function is passed in params',
    'it should wire run.console to that function instead of the real terminal',
  ].join(', '),
  () => {
    // given
    const workspace = mkdtempSync(join(tmpdir(), 'crust-write-injection-'))
    execFileSync('git', ['init', '-q'], { cwd: workspace })
    mkdirSync(join(workspace, '.pi-crust'), { recursive: true })
    const tracer = createTracer(
      join(workspace, 'crust.db'),
      join(workspace, 'events.jsonl'),
    )
    const stdout = spyOn(process.stdout, 'write').mockImplementation(
      () => true,
    )
    const written: string[] = []

    // when
    const run = createRun({
      cfg: crustConfigSchema.parse({
        defaults: { data_dir: join(workspace, '.pi-crust', 'data') },
        observability: { db: join(workspace, 'crust.db') },
        agents: [],
      }),
      runId: 'aaaa1111',
      tracer,
      engineer: 'tester',
      write: (text) => {
        // biome-ignore lint/plugin/no-array-mutation: recording what was written is the test
        written.push(text)
      },
    })
    run.console.sessionStarted('aaaa1111', 'tester', workspace, workspace)

    // then
    expect(stdout).not.toHaveBeenCalled()
    expect(written.length).toBeGreaterThan(0)
    stdout.mockRestore()
    run.tracer.close()
  },
)

test(
  [
    'given use-cases/start-session::startSession',
    'when no write option is passed',
    'it should still print the session-started banner through the real terminal',
  ].join(', '),
  () => {
    // given
    const dir = mkdtempSync(join(tmpdir(), 'crust-start-session-write-'))
    const dataDir = join(dir, 'data')
    // biome-ignore lint/plugin/no-object-mutation: process.env is the external API startSession reads, and this fixture is the adapter that owns the assignment
    process.env.CRUST_REGISTRY = join(dir, 'workspaces.jsonl')
    const cfg = crustConfigSchema.parse({
      defaults: { data_dir: dataDir },
      observability: { db: join(dataDir, 'crust.db') },
      agents: [],
    })
    const stdout = spyOn(process.stdout, 'write').mockImplementation(
      () => true,
    )

    // when
    const run = startSession(cfg, 'a1b2c3d4')

    // then — startSession itself prints a run_id banner as it starts a run
    expect(stdout).toHaveBeenCalled()
    stdout.mockRestore()
    run.tracer.close()
  },
)

test(
  [
    'given use-cases/start-session::startSession',
    'when a write option is passed',
    'it should never call process.stdout.write while starting the session',
  ].join(', '),
  () => {
    // given
    const dir = mkdtempSync(join(tmpdir(), 'crust-start-session-write-'))
    const dataDir = join(dir, 'data')
    // biome-ignore lint/plugin/no-object-mutation: process.env is the external API startSession reads, and this fixture is the adapter that owns the assignment
    process.env.CRUST_REGISTRY = join(dir, 'workspaces.jsonl')
    const cfg = crustConfigSchema.parse({
      defaults: { data_dir: dataDir },
      observability: { db: join(dataDir, 'crust.db') },
      agents: [],
    })
    const stdout = spyOn(process.stdout, 'write').mockImplementation(
      () => true,
    )

    // when
    const run = startSession(cfg, 'a1b2c3d4', { write: () => undefined })

    // then
    expect(stdout).not.toHaveBeenCalled()
    stdout.mockRestore()
    run.tracer.close()
  },
)
