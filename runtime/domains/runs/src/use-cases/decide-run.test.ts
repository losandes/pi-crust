import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EXIT } from '../../../../lib/contracts'
import { configText } from '../../../../testing/config-document'
import {
  restoreTerminal,
  silenceTerminal,
  terminalOutput,
} from '../../../../testing/terminal-capture'
import {
  INVOCATION_FILENAME,
  parseDecideArgs,
  type TDecideArgs,
} from '../../../cli'
import { createTracer } from '../../../trace'
import { answerText, decideRun } from '../..'

const main = (argv: readonly string[]) =>
  Promise.resolve(argv).then(parseDecideArgs).then(decideRun)

// decide.ts is the one in-scope CLI from issue #54 whose own argv parser
// (`parseDecideArgs`) had no direct test: `resume.ts` and `steer.ts` are
// covered through `cli-positionals.test.ts` and `resume-run.test.ts`, and
// `decide.ts`'s own `positionalArgs(argv, DECIDE_CLI)` call is covered
// there too, but nothing proved that decide's wrapper actually surfaces
// that refusal rather than catching or reshaping it.

const scratch = (): string => mkdtempSync(join(tmpdir(), 'crust-decide-'))

const anArgs = (
  overrides: Readonly<Partial<TDecideArgs>> = {},
): TDecideArgs => ({
  verb: 'approve',
  runId: 'fbf49583',
  note: '',
  file: '',
  db: undefined,
  config: 'pi-crust.toml',
  detach: true,
  ...overrides,
})

test(
  [
    'given decide::answerText',
    'when the verb is approve',
    'it should record approval with no further instruction',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given
      // when
      // when
      const actual = answerText(anArgs({ verb: 'approve' }))

      // then
      expect(actual).toContain('Approved')
    } finally {
      restoreTerminal()
    }
  },
)

test(
  [
    'given decide::answerText',
    'when the verb is reject with no --note',
    'it should throw, because a correction-free rejection tells the next stage nothing',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given
      // when
      // then
      // when
      // then
      expect(() => answerText(anArgs({ verb: 'reject', note: '  ' }))).toThrow(
        /reject needs --note/,
      )
    } finally {
      restoreTerminal()
    }
  },
)

test(
  [
    'given decide::answerText',
    'when the verb is reject with a note',
    'it should attribute the correction to the engineer',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given
      // when
      // when
      const actual = answerText(
        anArgs({ verb: 'reject', note: 'use a different queue' }),
      )

      // then
      expect(actual).toContain('Rejected')
      expect(actual).toContain('use a different queue')
    } finally {
      restoreTerminal()
    }
  },
)

test(
  [
    'given decide::answerText',
    'when the verb is answer and --file does not resolve',
    'it should throw naming the path it tried',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given
      // when
      // then
      // when
      // then
      expect(() =>
        answerText(anArgs({ verb: 'answer', file: '/does/not/exist.md' })),
      ).toThrow(/answer needs --file/)
    } finally {
      restoreTerminal()
    }
  },
)

test(
  [
    'given decide::answerText',
    'when the verb is answer and --file resolves',
    'it should return the file\u2019s own content',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given
      const dir = scratch()
      const path = join(dir, 'answer.md')
      writeFileSync(path, 'the retention window is 90 days\n')

      // when
      const actual = answerText(anArgs({ verb: 'answer', file: path }))

      // then
      expect(actual).toContain('the retention window is 90 days')
    } finally {
      restoreTerminal()
    }
  },
)

test(
  [
    'given decide::main',
    'when no session exists for the given run-id',
    'it should print to stderr and return EXIT.USAGE',
  ].join(', '),
  async () => {
    // given
    silenceTerminal()
    try {
      // given
      const dir = scratch()
      const dbPath = join(dir, 'crust.db')
      const tracer = createTracer(dbPath, join(dir, 'events.jsonl'))
      tracer.close()

      // when
      const actual = await main(['approve', 'nosuchrun', '--db', dbPath])

      // then
      expect(actual).toEqual(EXIT.USAGE)
    } finally {
      restoreTerminal()
    }
  },
)

test(
  [
    'given decide::main',
    'when the run is not waiting for anyone',
    'it should refuse, saying there is nothing to answer',
  ].join(', '),
  async () => {
    // given
    silenceTerminal()
    try {
      // given
      const dir = scratch()
      const dbPath = join(dir, 'crust.db')
      const tracer = createTracer(dbPath, join(dir, 'events.jsonl'))
      tracer.sessionStart('bbbb2222', 'tester', 'sdlc')
      tracer.sessionRequest('bbbb2222', 'ship it')
      tracer.sessionFinish('bbbb2222', true)
      tracer.close()

      // when
      const actual = await main(['approve', 'bbbb2222', '--db', dbPath])

      // then
      expect(actual).toEqual(EXIT.USAGE)
    } finally {
      restoreTerminal()
    }
  },
)

test(
  [
    'given decide::main',
    'when a waiting run is approved and its recorded invocation exits cleanly',
    'it should write the answer, resume it, and carry its exit code',
  ].join(', '),
  async () => {
    // given
    silenceTerminal()
    try {
      // given
      const dataDir = scratch()
      const dbPath = join(dataDir, 'crust.db')
      const tracer = createTracer(dbPath, join(dataDir, 'events.jsonl'))
      tracer.sessionStart('cccc3333', 'tester', 'sdlc')
      tracer.sessionRequest('cccc3333', 'ship it')
      tracer.sessionWaiting('cccc3333')
      tracer.close()
      const sessionDir = join(dataDir, 'sessions', 'cccc3333')
      mkdirSync(sessionDir, { recursive: true })
      writeFileSync(
        join(sessionDir, INVOCATION_FILENAME),
        JSON.stringify({
          argv: ['bun', '-e', 'process.exit(0)'],
          cwd: process.cwd(),
        }),
      )
      const configPath = join(dataDir, 'pi-crust.toml')
      writeFileSync(
        configPath,
        configText({
          defaults: { data_dir: dataDir },
          observability: {},
          agents: [],
        }),
      )
      // No machine-level pi-crust.toml must be merged in — it would override
      // this test's own data_dir with whatever this developer machine has set.
      const originalMachineConfig = process.env.CRUST_MACHINE_CONFIG
      // biome-ignore lint/plugin/no-object-mutation: process.env is the external API loadConfig reads through machineConfigPath
      process.env.CRUST_MACHINE_CONFIG = join(dataDir, 'no-such-machine-config')

      try {
        // when
        const actual = await main([
          'approve',
          'cccc3333',
          '--db',
          dbPath,
          '--config',
          configPath,
          '--detach',
        ])

        // then
        expect(actual).toEqual(EXIT.SUCCESS)
        expect(terminalOutput()).toContain('recorded')
        expect(terminalOutput()).toContain('resuming:')
      } finally {
        if (originalMachineConfig === undefined) {
          delete process.env.CRUST_MACHINE_CONFIG
        } else {
          // biome-ignore lint/plugin/no-object-mutation: restoring the environment this test borrowed
          process.env.CRUST_MACHINE_CONFIG = originalMachineConfig
        }
      }
    } finally {
      restoreTerminal()
    }
  },
)

test(
  [
    'given decide::main',
    'when a waiting run is approved but never recorded how it was invoked',
    'it should still write the answer, then report it could not resume automatically',
  ].join(', '),
  async () => {
    // given
    silenceTerminal()
    try {
      // given
      const dataDir = scratch()
      const dbPath = join(dataDir, 'crust.db')
      const tracer = createTracer(dbPath, join(dataDir, 'events.jsonl'))
      tracer.sessionStart('dddd4444', 'tester', 'sdlc')
      tracer.sessionRequest('dddd4444', 'ship it')
      tracer.sessionWaiting('dddd4444')
      tracer.close()
      // no invocation.json written at all
      const configPath = join(dataDir, 'pi-crust.toml')
      writeFileSync(
        configPath,
        configText({
          defaults: { data_dir: dataDir },
          observability: {},
          agents: [],
        }),
      )
      const originalMachineConfig = process.env.CRUST_MACHINE_CONFIG
      // biome-ignore lint/plugin/no-object-mutation: process.env is the external API loadConfig reads through machineConfigPath
      process.env.CRUST_MACHINE_CONFIG = join(dataDir, 'no-such-machine-config')

      try {
        // when
        const actual = await main([
          'approve',
          'dddd4444',
          '--db',
          dbPath,
          '--config',
          configPath,
        ])

        // then
        expect(actual).toEqual(EXIT.SUCCESS)
        expect(terminalOutput()).toContain('could not resume automatically')
      } finally {
        if (originalMachineConfig === undefined) {
          delete process.env.CRUST_MACHINE_CONFIG
        } else {
          // biome-ignore lint/plugin/no-object-mutation: restoring the environment this test borrowed
          process.env.CRUST_MACHINE_CONFIG = originalMachineConfig
        }
      }
    } finally {
      restoreTerminal()
    }
  },
)
