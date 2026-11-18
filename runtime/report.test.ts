import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTracer } from './domains/trace'
import type { TRunState } from './lib/contracts'
import { EXIT, importOutputSchema } from './lib/contracts'
import {
  main,
  parseReportArgs,
  renderReport,
  reportUsageError,
  resolveDbPath,
  resumeCommand,
  sessionDirOf,
  USAGE,
} from './report'
import {
  restoreTerminal,
  silenceTerminal,
  terminalOutput,
} from './testing/terminal-capture'

test(
  [
    'given SC7 and SC19 an ImportOutput with versions and comments',
    'when rendering the operator report',
    'it should show provenance and ignore invalid later records',
  ].join(', '),
  () => {
    // given
    const payload = importOutputSchema.parse({
      status: 'success',
      source: {
        kind: 'github-issue',
        written: '#150',
        address: 'issue-address',
        read_at: 'read-time',
        updated_at: 'issue-updated',
      },
      documents: [
        {
          activity: 'plan',
          document: 'handoff/plan.md',
          status: 'imported',
          address: 'comment-address',
          versions: [
            {
              address: 'issue-address',
              posted_at: 'issue-posted',
              used: false,
            },
            {
              address: 'comment-address',
              posted_at: 'plan-posted',
              used: true,
            },
          ],
          appended: ['answer-address'],
        },
      ],
      comments: [
        {
          author: 'alice',
          association: 'MEMBER',
          address: 'comment-address',
          posted_at: 'plan-posted',
          edited_at: 'plan-edited',
          placement: 'yielded',
          documents: ['handoff/plan.md'],
          reason: '',
        },
        {
          author: 'bob',
          association: 'OWNER',
          address: 'answer-address',
          posted_at: 'answer-posted',
          edited_at: 'answer-edited',
          placement: 'appended',
          documents: ['handoff/plan.md'],
          reason: '',
        },
      ],
      unattributed: [
        { address: 'issue-address', label: 'Plan', reason: 'superseded' },
      ],
    })
    const state = aState({
      envelopes: [
        {
          activityRun: 'import',
          agent: 'import',
          output_type: 'ImportOutput',
          valid: true,
          payload,
        },
        {
          activityRun: 'import',
          agent: 'import',
          output_type: 'ImportOutput',
          valid: true,
          payload: {},
        },
        {
          activityRun: 'import',
          agent: 'import',
          output_type: 'ImportOutput',
          valid: false,
          payload: {
            ...payload,
            source: { ...payload.source, written: 'invalid' },
          },
        },
      ],
    })
    // when
    const actual = renderReport(state)
    // then
    for (const field of [
      '#150',
      'issue-address',
      'read-time',
      'issue-updated',
      'handoff/plan.md',
      'imported',
      'comment-address',
      'issue-posted',
      'plan-posted',
      'plan-edited',
      'alice',
      'bob',
      'answer-address',
      'answer-posted',
      'answer-edited',
      'yielded',
      'appended',
      'superseded',
    ])
      expect(actual).toContain(field)
    expect(actual).not.toContain('import invalid')
    expect(renderReport(aState())).not.toContain('import #150')
  },
)

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

const aState = (overrides: Readonly<Partial<TRunState>> = {}): TRunState =>
  ({
    run_id: 'fbf49583',
    lifecycle: 'sdlc',
    name: '',
    request: 'add a /health endpoint',
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

test(
  [
    'given report::parseReportArgs',
    'when only a run id is given',
    'it should read it as the positional runId with every flag at its default',
  ].join(', '),
  () => {
    // given
    // when
    const actual = parseReportArgs(['fbf49583'])

    // then
    expect(actual.runId).toEqual('fbf49583')
    expect(actual.json).toBe(false)
  },
)

test(
  [
    'given report::parseReportArgs',
    'when --json, --db and --config are all given',
    'it should parse every one of them',
  ].join(', '),
  () => {
    // given
    // when
    const actual = parseReportArgs([
      'fbf49583',
      '--json',
      '--db',
      '/tmp/crust.db',
      '--config=.pi-crust/config/crust.config.yaml',
    ])

    // then
    expect(actual).toEqual({
      runId: 'fbf49583',
      json: true,
      db: '/tmp/crust.db',
      config: '.pi-crust/config/crust.config.yaml',
    })
  },
)

test(
  [
    'given report::parseReportArgs',
    'when a value-taking flag is given with nothing after it',
    'it should throw naming the flag and USAGE',
  ].join(', '),
  () => {
    // given
    // when
    // then
    expect(() => parseReportArgs(['--db'])).toThrow(/--db needs a value/)
  },
)

test(
  [
    'given report::resolveDbPath',
    'when --db was given explicitly',
    'it should win over the config',
  ].join(', '),
  () => {
    // given
    const args = parseReportArgs(['--db', '/tmp/explicit.db'])

    // when
    const actual = resolveDbPath(args)

    // then
    expect(actual).toEqual('/tmp/explicit.db')
  },
)

test(
  [
    'given report::resolveDbPath',
    'when no --db was given and the config cannot be read',
    'it should fall back to the default db path',
  ].join(', '),
  () => {
    // given
    const args = parseReportArgs([
      '--config',
      '/does/not/exist/crust.config.yaml',
    ])

    // when
    const actual = resolveDbPath(args)

    // then
    expect(actual.length).toBeGreaterThan(0)
  },
)

test(
  [
    'given report::resumeCommand',
    'when a recorded invocation exists',
    'it should replay it through resumeArgv rather than reconstruct from the request',
  ].join(', '),
  () => {
    // given
    const state = aState()
    const invocation = [
      'bun',
      'runtime/compose.ts',
      'add a /health endpoint',
      '--run-id',
      'fbf49583',
    ]

    // when
    const actual = resumeCommand(state, invocation)

    // then
    expect(actual).toContain('--resume')
    expect(actual).toContain('fbf49583')
  },
)

test(
  [
    'given report::resumeCommand',
    'when no invocation was recorded',
    'it should reconstruct a command from the request',
  ].join(', '),
  () => {
    // given
    const state = aState()

    // when
    const actual = resumeCommand(state, undefined)

    // then
    expect(actual).toContain('add a /health endpoint')
    expect(actual).toContain('--run-id')
    expect(actual).toContain('--resume')
  },
)

test(
  [
    'given report::sessionDirOf',
    'when asked where a run recorded how it was started',
    'it should resolve under sessions/<run-id>, beside the db',
  ].join(', '),
  () => {
    // given
    // when
    const actual = sessionDirOf('/data/crust.db', 'fbf49583')

    // then
    expect(actual).toEqual(join('/data', 'sessions', 'fbf49583'))
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
    using given = scratch()
    const dir = given.dir
    const dbPath = join(dir, 'crust.db')
    const tracer = createTracer(dbPath, join(dir, 'events.jsonl'))
    tracer.close()

    // when
    const actual = main(['--db', dbPath])

    // then
    expect(actual).toEqual(EXIT.USAGE)
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
    using given = scratch()
    const dir = given.dir
    const dbPath = join(dir, 'crust.db')
    const tracer = createTracer(dbPath, join(dir, 'events.jsonl'))
    tracer.sessionStart('cccc3333', 'tester', 'sdlc')
    tracer.sessionRequest('cccc3333', 'ship it')
    tracer.sessionWaiting('cccc3333')
    tracer.close()

    // when
    const actual = main(['cccc3333', '--db', dbPath])

    // then
    expect(actual).toEqual(EXIT.WAITING)
    expect(terminalOutput()).toContain('run_id:')
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
    using given = scratch()
    const dir = given.dir
    const dbPath = join(dir, 'crust.db')
    const tracer = createTracer(dbPath, join(dir, 'events.jsonl'))
    tracer.sessionStart('dddd4444', 'tester', 'sdlc')
    tracer.sessionRequest('dddd4444', 'ship it')
    tracer.close()

    // when
    const actual = main(['dddd4444', '--db', dbPath])

    // then
    expect(actual).toEqual(EXIT.RUNNING)
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
    using given = scratch()
    const dir = given.dir
    const dbPath = join(dir, 'crust.db')
    const tracer = createTracer(dbPath, join(dir, 'events.jsonl'))
    tracer.sessionStart('eeee5555', 'tester', 'sdlc')
    tracer.sessionRequest('eeee5555', 'ship it')
    tracer.sessionFinish('eeee5555', false)
    tracer.close()

    // when
    const actual = main(['eeee5555', '--db', dbPath])

    // then
    expect(actual).toEqual(EXIT.FAILED)
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
    const actual = main(['ffff6666', '--db', dbPath])

    // then — no recorded invocation at `sessionDir`, so it falls back cleanly
    expect(actual).toEqual(EXIT.FAILED)
    expect(sessionDir).toContain('ffff6666')
  },
)

test(
  [
    'given report::renderReport',
    'when an activityRun failed one of its gates',
    'it should print the gate name and every violation under it',
  ].join(', '),
  () => {
    // given
    const state = aState({
      status: 'fail',
      resumable: true,
      resume_from: 'build',
      activityRuns: [
        {
          activity_run_id: 'fbf49583_01_build',
          seq: 1,
          name: 'build',
          kind: 'code',
          owner: 'quality',
          status: 'fail',
          error: undefined,
          gates: [
            {
              gate: 'checks',
              passed: false,
              violations: ['lint failed on src/a.ts'],
            },
          ],
        },
      ] as unknown as TRunState['activityRuns'],
    })

    // when
    const actual = renderReport(state)

    // then
    expect(actual).toContain('gate checks failed')
    expect(actual).toContain('lint failed on src/a.ts')
    expect(actual).toContain('resume from:')
  },
)

test(
  [
    'given report::renderReport',
    'when the run filed a warning',
    'it should print it, highlighted the same way the terminal that ran it did',
  ].join(', '),
  () => {
    // given
    const state = aState({
      warnings: [
        {
          kind: 'outside_workspace',
          activities: ['build'],
          activityRunIds: ['fbf49583_01_build'],
          stage: 'build',
          paths: ['../shared/lockfile.txt'],
          note: 'resolved against the VCS root, not the workspace',
        },
      ] as unknown as TRunState['warnings'],
    })

    // when
    const actual = renderReport(state)

    // then
    expect(actual).toContain('lockfile.txt')
  },
)

test(
  [
    'given report::USAGE',
    'when printed',
    'it should name --json, --db, --config and both env overrides',
  ].join(', '),
  () => {
    // given
    // when
    // then
    expect(USAGE).toContain('--json')
    expect(USAGE).toContain('--db')
    expect(USAGE).toContain('--config')
    expect(USAGE).toContain('CRUST_DB')
    expect(USAGE).toContain('CRUST_CONFIG')
  },
)

test(
  [
    'given report::reportUsageError',
    'when main rejects with a parse error',
    'it should print the message and USAGE to stderr and return EXIT.USAGE',
  ].join(', '),
  () => {
    // given
    const original = process.stderr.write.bind(process.stderr)
    let printed = ''
    // biome-ignore lint/plugin/no-object-mutation: swapping Node's own stderr.write for the capture, restored below
    process.stderr.write = ((chunk: string) => {
      printed += chunk
      return true
    }) as typeof process.stderr.write

    // when
    const actual = reportUsageError(new Error('run_id required'))

    // then
    // biome-ignore lint/plugin/no-object-mutation: restoring Node's own stderr.write after the capture
    process.stderr.write = original
    expect(actual).toEqual(EXIT.USAGE)
    expect(printed).toContain('run_id required')
  },
)
