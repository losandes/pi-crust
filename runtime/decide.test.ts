import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TDecideArgs } from './decide'
import {
  answerText,
  isVerb,
  main,
  parseDecideArgs,
  reportUsageError,
  USAGE,
  VERBS,
} from './decide'
import { createTracer } from './modules/data/trace-db'
import {
  restoreTerminal,
  silenceTerminal,
  terminalOutput,
} from './modules/testing/terminal-capture'
import { EXIT } from './modules/typedefs/run-state'
import { INVOCATION_FILENAME } from './modules/use-cases/resume-run'

beforeEach(silenceTerminal)
afterEach(restoreTerminal)

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
  config: '.pi-crust/config/crust.config.yaml',
  detach: true,
  ...overrides,
})

test(
  [
    'given decide::parseDecideArgs',
    'when a valid verb and run id are given',
    'it should parse both, with no note or file',
  ].join(', '),
  () => {
    // given
    const argv = ['approve', 'a1b2c3d4']

    // when
    const actual = parseDecideArgs(argv)

    // then
    expect(actual.verb).toEqual('approve')
    expect(actual.runId).toEqual('a1b2c3d4')
    expect(actual.note).toEqual('')
    expect(actual.file).toEqual('')
  },
)

test(
  [
    'given decide::parseDecideArgs',
    'when an unrecognised single-dash token is given',
    'it should refuse by name instead of reading it as the verb or run id',
  ].join(', '),
  () => {
    // given
    const argv = ['-x', 'approve', 'a1b2c3d4']

    // when, then
    expect(() => parseDecideArgs(argv)).toThrow(/unknown flag: -x/)
  },
)

test(
  [
    'given decide::parseDecideArgs',
    'when the unrecognised token sits between the verb and the run id',
    'it should still refuse by name rather than treating the token as the run id',
  ].join(', '),
  () => {
    // given
    const argv = ['reject', '-x', 'a1b2c3d4']

    // when, then
    expect(() => parseDecideArgs(argv)).toThrow(/unknown flag: -x/)
  },
)

test(
  [
    'given decide::parseDecideArgs',
    'when the token is exactly a bare dash',
    'it should refuse rather than read it as the run id',
  ].join(', '),
  () => {
    // given
    const argv = ['approve', '-']

    // when, then
    expect(() => parseDecideArgs(argv)).toThrow(/unknown flag/)
  },
)

test(
  [
    'given decide::parseDecideArgs',
    'when --note precedes the run id',
    'it should resolve the run id rather than the note text',
  ].join(', '),
  () => {
    // given
    const argv = ['reject', '--note', 'fix the thing', 'a1b2c3d4']

    // when
    const actual = parseDecideArgs(argv)

    // then
    expect(actual.runId).toEqual('a1b2c3d4')
    expect(actual.note).toEqual('fix the thing')
  },
)

test(
  [
    'given decide::isVerb',
    'when every entry in VERBS is inspected',
    'it should accept each one',
  ].join(', '),
  () => {
    // given, when, then
    for (const verb of VERBS) {
      expect(isVerb(verb)).toBe(true)
    }
  },
)

test(
  [
    'given decide::isVerb',
    'when the value is not a recognised verb',
    'it should say so',
  ].join(', '),
  () => {
    // given, when, then
    expect(isVerb('deny')).toBe(false)
  },
)

test(
  [
    'given decide::parseDecideArgs',
    'when the first argument is not a recognised verb',
    'it should throw naming the ones it accepts',
  ].join(', '),
  () => {
    // given, when, then
    expect(() => parseDecideArgs(['deny', 'fbf49583'])).toThrow(
      /must be one of approve, reject, answer/,
    )
  },
)

test(
  [
    'given decide::parseDecideArgs',
    'when no run-id follows the verb',
    'it should throw, because there is nothing to answer',
  ].join(', '),
  () => {
    // given, when, then
    expect(() => parseDecideArgs(['approve'])).toThrow(/run-id is required/)
  },
)

test(
  [
    'given decide::parseDecideArgs',
    'when every flag is given',
    'it should parse all of them, including --detach',
  ].join(', '),
  () => {
    // given, when
    const actual = parseDecideArgs([
      'reject',
      'fbf49583',
      '--note',
      'wrong approach',
      '--file',
      'answer.md',
      '--db',
      '/tmp/crust.db',
      '--config',
      '/tmp/crust.config.yaml',
      '--detach',
    ])

    // then
    expect(actual).toEqual({
      verb: 'reject',
      runId: 'fbf49583',
      note: 'wrong approach',
      file: 'answer.md',
      db: '/tmp/crust.db',
      config: '/tmp/crust.config.yaml',
      detach: true,
    })
  },
)

test(
  [
    'given decide::answerText',
    'when the verb is approve',
    'it should record approval with no further instruction',
  ].join(', '),
  () => {
    // given, when
    const actual = answerText(anArgs({ verb: 'approve' }))

    // then
    expect(actual).toContain('Approved')
  },
)

test(
  [
    'given decide::answerText',
    'when the verb is reject with no --note',
    'it should throw, because a correction-free rejection tells the next stage nothing',
  ].join(', '),
  () => {
    // given, when, then
    expect(() => answerText(anArgs({ verb: 'reject', note: '  ' }))).toThrow(
      /reject needs --note/,
    )
  },
)

test(
  [
    'given decide::answerText',
    'when the verb is reject with a note',
    'it should attribute the correction to the engineer',
  ].join(', '),
  () => {
    // given, when
    const actual = answerText(
      anArgs({ verb: 'reject', note: 'use a different queue' }),
    )

    // then
    expect(actual).toContain('Rejected')
    expect(actual).toContain('use a different queue')
  },
)

test(
  [
    'given decide::answerText',
    'when the verb is answer and --file does not resolve',
    'it should throw naming the path it tried',
  ].join(', '),
  () => {
    // given, when, then
    expect(() =>
      answerText(anArgs({ verb: 'answer', file: '/does/not/exist.md' })),
    ).toThrow(/answer needs --file/)
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
    const dir = scratch()
    const path = join(dir, 'answer.md')
    writeFileSync(path, 'the retention window is 90 days\n')

    // when
    const actual = answerText(anArgs({ verb: 'answer', file: path }))

    // then
    expect(actual).toContain('the retention window is 90 days')
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
    const dir = scratch()
    const dbPath = join(dir, 'crust.db')
    const tracer = createTracer(dbPath, join(dir, 'events.jsonl'))
    tracer.close()

    // when
    const actual = await main(['approve', 'nosuchrun', '--db', dbPath])

    // then
    expect(actual).toEqual(EXIT.USAGE)
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
    const configPath = join(dataDir, 'crust.config.yaml')
    writeFileSync(
      configPath,
      `defaults:\n  data_dir: ${dataDir}\nobservability:\n  db: ${dbPath}\nagents: []\n`,
    )
    // No machine-level crust.config.yaml must be merged in — it would override
    // this test's own data_dir with whatever this developer machine has set.
    const originalMachineConfig = process.env.CRUST_MACHINE_CONFIG
    // biome-ignore lint/plugin/no-object-mutation: process.env is the external API loadConfig reads through machineConfigPath
    process.env.CRUST_MACHINE_CONFIG = join(
      dataDir,
      'no-such-machine-config.yaml',
    )

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
    const dataDir = scratch()
    const dbPath = join(dataDir, 'crust.db')
    const tracer = createTracer(dbPath, join(dataDir, 'events.jsonl'))
    tracer.sessionStart('dddd4444', 'tester', 'sdlc')
    tracer.sessionRequest('dddd4444', 'ship it')
    tracer.sessionWaiting('dddd4444')
    tracer.close()
    // no invocation.json written at all
    const configPath = join(dataDir, 'crust.config.yaml')
    writeFileSync(
      configPath,
      `defaults:\n  data_dir: ${dataDir}\nobservability:\n  db: ${dbPath}\nagents: []\n`,
    )
    const originalMachineConfig = process.env.CRUST_MACHINE_CONFIG
    // biome-ignore lint/plugin/no-object-mutation: process.env is the external API loadConfig reads through machineConfigPath
    process.env.CRUST_MACHINE_CONFIG = join(
      dataDir,
      'no-such-machine-config.yaml',
    )

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
  },
)

test(
  [
    'given decide::reportUsageError',
    'when main rejects with a parse error',
    'it should print the message and USAGE to stderr and return EXIT.USAGE',
  ].join(', '),
  () => {
    // given
    const writes: string[] = []
    const stderrSpy = spyOn(process.stderr, 'write').mockImplementation(((
      chunk: string,
    ) => {
      // biome-ignore lint/plugin/no-array-mutation: recording what was written is the test
      writes.push(chunk)
      return true
    }) as never)

    try {
      // when
      const actual = reportUsageError(new Error('an run-id is required'))

      // then
      expect(actual).toEqual(EXIT.USAGE)
      expect(writes.join('')).toContain('an run-id is required')
      expect(writes.join('')).toContain(USAGE)
    } finally {
      stderrSpy.mockRestore()
    }
  },
)

test(
  [
    'given decide::USAGE',
    'when printed',
    'it should name all three verbs and both overrides',
  ].join(', '),
  () => {
    // given, when, then
    expect(USAGE).toContain('approve')
    expect(USAGE).toContain('reject')
    expect(USAGE).toContain('answer')
    expect(USAGE).toContain('CRUST_DB')
    expect(USAGE).toContain('CRUST_CONFIG')
  },
)
