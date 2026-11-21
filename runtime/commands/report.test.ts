import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionDirOf } from '../domains/cli'
import { createTracer } from '../domains/trace'
import { EXIT } from '../lib/contracts'
import { SKIP_INTEGRATION } from '../testing/integration'
import {
  restoreTerminal,
  silenceTerminal,
  terminalOutput,
} from '../testing/terminal-capture'
import { tokenRepo } from '../testing/token-repo'
import { main } from './report'

const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), 'crust-report-'))
  silenceTerminal()
  return {
    dir,
    [Symbol.dispose]: () => {
      restoreTerminal()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

test.skipIf(SKIP_INTEGRATION)(
  [
    'given report with token configuration',
    'when reading a recorded run as JSON',
    'it should find the run in the configured store',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given
      using fixture = tokenRepo()

      // when
      const child = fixture.invoke('report.ts', [
        fixture.runId,
        '--json',
        '--config',
        fixture.configPath,
      ])
      const output = child.stdout.toString()

      // then
      expect(child.exitCode).toBe(EXIT.FAILED)
      expect(output).not.toContain('no session found')
      expect(JSON.parse(output).run_id).toBe(fixture.runId)
    } finally {
      restoreTerminal()
    }
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given report with token configuration and an overriding store',
    'when a failed run recorded its invocation under the configured data directory',
    'it should retain the lifecycle flag from that recorded invocation',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given
      using fixture = tokenRepo({ overrideDb: true })
      writeFileSync(
        join(fixture.sessionDir, 'invocation.json'),
        JSON.stringify({
          argv: [
            'bun',
            join(fixture.root, 'run.ts'),
            'fixture request',
            '--lifecycle',
            'sdlc',
          ],
          cwd: fixture.root,
        }),
      )

      // when
      const child = fixture.invoke('report.ts', [fixture.runId])

      // then
      expect(child.exitCode).toBe(EXIT.FAILED)
      expect(child.stdout.toString()).toContain('--lifecycle sdlc')
    } finally {
      restoreTerminal()
    }
  },
)

test(
  [
    'given report::main',
    'when no session exists for the db at all',
    'it should print USAGE to stderr and return EXIT.USAGE',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given
      using given = scratch()
      const dir = given.dir
      const dbPath = join(dir, 'crust.db')
      const tracer = createTracer(dbPath, join(dir, 'events.jsonl'))
      tracer.close()

      // when
      const actual = main(['--db', dbPath])

      // then
      expect(actual).toEqual(EXIT.USAGE)
    } finally {
      restoreTerminal()
    }
  },
)

test(
  [
    'given report::main',
    'when a run succeeded and --json is given',
    'it should print the state verbatim and return EXIT.SUCCESS',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given
      using given = scratch()
      const dir = given.dir
      const dbPath = join(dir, 'crust.db')
      const tracer = createTracer(dbPath, join(dir, 'events.jsonl'))
      tracer.sessionStart('bbbb2222', 'tester', 'sdlc')
      tracer.sessionRequest('bbbb2222', 'ship it')
      tracer.sessionFinish('bbbb2222', true)
      tracer.close()

      // when
      const actual = main(['bbbb2222', '--json', '--db', dbPath])

      // then
      expect(actual).toEqual(EXIT.SUCCESS)
      expect(terminalOutput()).toContain('"run_id"')
    } finally {
      restoreTerminal()
    }
  },
)

test(
  [
    'given report::main',
    'when a run is waiting for a person',
    'it should print the plain report and return EXIT.WAITING',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given
      using given = scratch()
      const dir = given.dir
      const dbPath = join(dir, 'crust.db')
      const tracer = createTracer(dbPath, join(dir, 'events.jsonl'))
      tracer.sessionStart('cccc3333', 'tester', 'sdlc')
      tracer.sessionRequest('cccc3333', 'ship it')
      tracer.sessionWaiting('cccc3333')
      tracer.close()

      // when
      const actual = main([
        'cccc3333',
        '--db',
        dbPath,
        '--config',
        join(dir, 'missing.config.yaml'),
      ])

      // then
      expect(actual).toEqual(EXIT.WAITING)
      expect(terminalOutput()).toContain('run_id:')
    } finally {
      restoreTerminal()
    }
  },
)

test(
  [
    'given report::main',
    'when a run is still running',
    'it should return EXIT.RUNNING',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given
      using given = scratch()
      const dir = given.dir
      const dbPath = join(dir, 'crust.db')
      const tracer = createTracer(dbPath, join(dir, 'events.jsonl'))
      tracer.sessionStart('dddd4444', 'tester', 'sdlc')
      tracer.sessionRequest('dddd4444', 'ship it')
      tracer.close()

      // when
      const actual = main([
        'dddd4444',
        '--db',
        dbPath,
        '--config',
        join(dir, 'missing.config.yaml'),
      ])

      // then
      expect(actual).toEqual(EXIT.RUNNING)
    } finally {
      restoreTerminal()
    }
  },
)

test(
  [
    'given report::main',
    'when a run failed outright',
    'it should return EXIT.FAILED',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given
      using given = scratch()
      const dir = given.dir
      const dbPath = join(dir, 'crust.db')
      const tracer = createTracer(dbPath, join(dir, 'events.jsonl'))
      tracer.sessionStart('eeee5555', 'tester', 'sdlc')
      tracer.sessionRequest('eeee5555', 'ship it')
      tracer.sessionFinish('eeee5555', false)
      tracer.close()

      // when
      const actual = main([
        'eeee5555',
        '--db',
        dbPath,
        '--config',
        join(dir, 'missing.config.yaml'),
      ])

      // then
      expect(actual).toEqual(EXIT.FAILED)
    } finally {
      restoreTerminal()
    }
  },
)

test(
  [
    'given report::main',
    'when the recorded invocation for the run is found on disk',
    'it should reach resumeCommand through it rather than reconstructing the request',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given
      using given = scratch()
      const dir = given.dir
      const dbPath = join(dir, 'crust.db')
      const tracer = createTracer(dbPath, join(dir, 'events.jsonl'))
      tracer.sessionStart('ffff6666', 'tester', 'sdlc')
      tracer.sessionRequest('ffff6666', 'ship it')
      tracer.sessionFinish('ffff6666', false)
      tracer.close()
      const sessionDir = sessionDirOf(dbPath, 'ffff6666')
      writeFileSync(
        join(dir, 'invocation.json'),
        '', // not under sessionDir — just proves the lookup tolerates absence
      )

      // when
      const actual = main([
        'ffff6666',
        '--db',
        dbPath,
        '--config',
        join(dir, 'missing.config.yaml'),
      ])

      // then — no recorded invocation at `sessionDir`, so it falls back cleanly
      expect(actual).toEqual(EXIT.FAILED)
      expect(sessionDir).toContain('ffff6666')
    } finally {
      restoreTerminal()
    }
  },
)
