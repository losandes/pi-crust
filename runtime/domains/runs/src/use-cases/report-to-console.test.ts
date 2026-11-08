import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  TEnvelopeBase,
  TGateReport,
  TRun,
  TTracer,
} from '../../../../lib/contracts'
import { activityRunParams, crustConfigSchema } from '../../../../lib/contracts'
import {
  restoreTerminal,
  silenceTerminal,
} from '../../../../testing/terminal-capture'
import { checks } from '../../../gates'
import { createTracer } from '../../../trace'
import {
  createConsole,
  PROMPT_BODY_CHARS,
  PROMPT_BODY_LINES,
} from './report-to-console'

beforeEach(silenceTerminal)
afterEach(restoreTerminal)

/** A tracer that records every `message` the console emitted, as plain text. */
const tracedMessages = (): Readonly<{
  tracer: TTracer
  messages: string[]
}> => {
  const messages: string[] = []
  const tracer = {
    event: (
      input: Readonly<{ payload?: Readonly<Record<string, unknown>> }>,
    ) => {
      const message = input.payload?.message
      if (typeof message === 'string') {
        // biome-ignore lint/plugin/no-array-mutation: recording what was emitted is the test
        messages.push(message)
      }
      return ''
    },
  } as unknown as TTracer

  return { tracer, messages }
}

test(
  [
    'given use-cases/report-to-console::createConsole',
    'when the workspace root and the VCS root differ',
    'it should print both, named, in the start-of-run banner (1.5.1)',
  ].join(', '),
  () => {
    // given
    const { tracer, messages } = tracedMessages()
    const console_ = createConsole(tracer, 'aaaa1111')

    // when
    console_.sessionStarted('aaaa1111', 'tester', '/repo/_newstack', '/repo')

    // then
    expect(messages.some((line) => line.includes('/repo/_newstack'))).toBe(true)
    expect(messages.some((line) => line.includes('/repo'))).toBe(true)
  },
)

test(
  [
    'given use-cases/report-to-console::createConsole',
    'when the workspace root equals the VCS root',
    'it should print the banner exactly as before this spec \u2014 no root line at all (1.5.3, 1.6.2)',
  ].join(', '),
  () => {
    // given — the ordinary, unnested case
    const { tracer, messages } = tracedMessages()
    const console_ = createConsole(tracer, 'aaaa1111')

    // when
    console_.sessionStarted('aaaa1111', 'tester', '/repo', '/repo')

    // then — the one banner line, nothing naming a second root
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain('run_id:')
  },
)

/**
 * A tracer that both records plain messages (what `tracedMessages` does) and
 * replays filed events back through `eventsNamed` — what `sessionFinished`
 * reads to find the run's warnings (1.2.2).
 */
const tracedRunTracer = (): Readonly<{
  tracer: TTracer
  messages: string[]
}> => {
  const messages: string[] = []
  const filed: Readonly<{
    name: string
    payload: Readonly<Record<string, unknown>> | undefined
  }>[] = []
  const tracer = {
    event: (
      input: Readonly<{
        name?: string
        payload?: Readonly<Record<string, unknown>>
      }>,
    ) => {
      // biome-ignore lint/plugin/no-array-mutation: recording what was filed is the test
      filed.push({ name: input.name ?? '', payload: input.payload })
      const message = input.payload?.message
      if (typeof message === 'string') {
        // biome-ignore lint/plugin/no-array-mutation: recording what was emitted is the test
        messages.push(message)
      }
      return ''
    },
    eventsNamed: (_runId: string, name: string) =>
      filed
        .filter((event) => event.name === name)
        .map((event) => event.payload ?? {}),
    // the end-of-run ratio is read from the trace now, and this run has no rows
    activityRunsFor: () => [],
  } as unknown as TTracer

  return { tracer, messages }
}

const builtEnvelope = (changed: readonly string[]): TEnvelopeBase =>
  ({
    status: 'success',
    summary: 'built it',
    artifacts: [],
    notes_for_next_agent: '',
    facts: [],
    decisions: [],
    assumptions: [],
    unresolved: [],
    risks: [],
    objective_met: { met: true, evidence: 'it builds' },
    regress_to: { activity: '', because: '' },
    changed_files: changed,
  }) as unknown as TEnvelopeBase

test(
  [
    'given use-cases/report-to-console::createConsole',
    'when a change touched only paths no routing.checks rule covered',
    'it should carry a run warning naming those paths all the way to the end-of-run report (1.2.1, 1.2.2)',
  ].join(', '),
  () => {
    // given — the same tracer feeds both the gate that observes the gap and
    // the console that is supposed to report it at the end of the run
    const { tracer, messages } = tracedRunTracer()
    const dir = mkdtempSync(join(tmpdir(), 'crust-report-console-'))
    const run = {
      cfg: crustConfigSchema.parse({
        routing: {
          checks: [
            {
              name: 'lint',
              when: ['**/*.md'],
              operation: 'lint',
              argv: ['true'],
            },
          ],
        },
        agents: [],
      }),
      runId: 'aaaa1111',
      repoRoot: dir,
      contextHandoffDir: dir,
      activityRuns: () => [],
      console: { note: () => undefined },
      tracer,
    } as unknown as TRun

    // when — the gate runs over a change the declared rule cannot reach,
    // then the run ends
    checks.check(builtEnvelope(['src/add.ts']), run, ['src/add.ts'])
    const console_ = createConsole(tracer, run.runId)
    console_.sessionFinished(true, 0, 0, '/tmp/crust.db')

    // then — the end-of-run report names the uncovered path, in the same
    // channel the other tree warnings use
    expect(messages.some((line) => line.includes('src/add.ts'))).toBe(true)
  },
)

test(
  [
    'given use-cases/report-to-console::sessionFinished',
    'when the run holds a superseded activity run alongside the successful retry that replaced it',
    'it should count only the rows the verdict counted, so the printed total agrees with the printed status (1.4.1, 1.4.2)',
  ].join(', '),
  () => {
    // given — a run shaped like 867e452d/b6f8f617: nine would read 9/9 fail
    // when the right count, excluding the superseded attempt, is 8/8 success.
    const dir = mkdtempSync(join(tmpdir(), 'crust-report-console-test-'))
    const dbPath = join(dir, 'crust.db')
    const tracer = createTracer(dbPath, join(dir, 'events.jsonl'))
    tracer.sessionStart('aaaa2222', 'tester', 'quality')
    const console_ = createConsole(tracer, 'aaaa2222')
    tracer.activityRunUpsert({
      activity_run_id: 'aaaa2222_01_build',
      run_id: 'aaaa2222',
      seq: 1,
      params: activityRunParams({
        name: 'build',
        kind: 'agent',
        owner: 'builder',
        description: 'Implement the design',
      }),
      status: 'superseded',
      error: undefined,
      started_at: undefined,
      ended_at: undefined,
    })
    tracer.activityRunUpsert({
      activity_run_id: 'aaaa2222_02_build',
      run_id: 'aaaa2222',
      seq: 2,
      params: activityRunParams({
        name: 'build',
        kind: 'agent',
        owner: 'builder',
        description: 'Implement the design',
      }),
      status: 'success',
      error: undefined,
      started_at: undefined,
      ended_at: undefined,
    })

    // when
    console_.sessionFinished(true, 0, 0, dbPath)

    // then — the superseded row is excluded from both halves of the ratio
    const messages = tracer
      .eventsNamed('aaaa2222', 'console')
      .map((payload) => String(payload.message ?? ''))
      .join('\n')
    expect(messages).toContain('1/1 activityRuns')
    expect(messages).not.toContain('2/2 activityRuns')
    expect(messages).not.toContain('1/2 activityRuns')
    tracer.close()
  },
)

test(
  [
    'given use-cases/report-to-console::createConsole',
    'when promptReceived is called with a prompt containing an embedded quote, a backtick and a newline',
    'it should trace the whole prompt verbatim, as one exact substring (1.1.2, 1.1.5)',
  ].join(', '),
  () => {
    // given
    const { tracer, messages } = tracedMessages()
    const console_ = createConsole(tracer, 'aaaa1111')
    const prompt = 'say "hello" then run `rm -rf /`\nand stop'

    // when
    console_.promptReceived(prompt)

    // then
    expect(messages.some((line) => line.includes(prompt))).toBe(true)
  },
)

test(
  [
    'given use-cases/report-to-console::createConsole',
    'when promptReceived is called with a prompt of 60 identical lines',
    'it should still trace the whole prompt, and the header should report the full character count (1.1.3, 1.1.5)',
  ].join(', '),
  () => {
    // given
    const { tracer, messages } = tracedMessages()
    const console_ = createConsole(tracer, 'aaaa1111')
    const line = 'x'.repeat(100)
    const prompt = Array.from({ length: 60 }, () => line).join('\n')
    expect(prompt.split('\n').length).toBeGreaterThan(PROMPT_BODY_LINES)
    expect(prompt.length).toBeGreaterThan(PROMPT_BODY_CHARS)

    // when
    console_.promptReceived(prompt)

    // then
    expect(messages.some((entry) => entry.includes(prompt))).toBe(true)
    expect(
      messages.some((entry) => entry.includes(`${prompt.length} chars`)),
    ).toBe(true)
  },
)

test(
  [
    'given use-cases/report-to-console::createConsole',
    'when promptReceived is called with an empty string',
    'it should emit exactly one event whose message contains 0 chars, and should not throw (1.1.4)',
  ].join(', '),
  () => {
    // given
    const { tracer, messages } = tracedMessages()
    const console_ = createConsole(tracer, 'aaaa1111')

    // when
    expect(() => console_.promptReceived('')).not.toThrow()

    // then
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain('0 chars')
  },
)

test(
  [
    'given use-cases/report-to-console::createConsole',
    'when an activity run starts and ends successfully',
    'it should print the start banner and a success mark, and clear the current lane',
  ].join(', '),
  () => {
    // given
    const { tracer, messages } = tracedMessages()
    const console_ = createConsole(tracer, 'aaaa1111')
    const activityRun = {
      activity_run_id: 'aaaa1111_01_build',
      seq: 1,
      params: activityRunParams({
        name: 'build',
        kind: 'code',
        owner: 'quality',
        description: 'write the code',
      }),
      status: 'success',
      error: undefined,
    } as unknown as Parameters<typeof console_.activityRunStarted>[0]

    // when
    console_.activityRunStarted(activityRun)
    console_.activityRunEnded(activityRun, 1.5)

    // then
    expect(messages.some((line) => line.includes('build'))).toBe(true)
    expect(messages.some((line) => line.includes('1.5s'))).toBe(true)
  },
)

test(
  [
    'given use-cases/report-to-console::createConsole',
    'when an activity run ends having failed, with an error message',
    'it should print the error alongside the failure mark',
  ].join(', '),
  () => {
    // given
    const { tracer, messages } = tracedMessages()
    const console_ = createConsole(tracer, 'aaaa1111')
    const activityRun = {
      activity_run_id: 'aaaa1111_01_build',
      seq: 1,
      params: activityRunParams({
        name: 'build',
        kind: 'code',
        owner: 'quality',
        description: 'write the code',
      }),
      status: 'fail',
      error: 'the build threw',
    } as unknown as Parameters<typeof console_.activityRunEnded>[0]

    // when
    console_.activityRunEnded(activityRun, 0.3)

    // then
    expect(messages.some((line) => line.includes('the build threw'))).toBe(true)
  },
)

test(
  [
    'given use-cases/report-to-console::createConsole',
    'when note is called with free-form detail',
    'it should print it, clipped the same way every other line is',
  ].join(', '),
  () => {
    // given
    const { tracer, messages } = tracedMessages()
    const console_ = createConsole(tracer, 'aaaa1111')

    // when
    console_.note('resolved against the VCS root')

    // then
    expect(
      messages.some((line) => line.includes('resolved against the VCS root')),
    ).toBe(true)
  },
)

test(
  [
    'given use-cases/report-to-console::createConsole',
    'when instructions prints a multi-line command, including a blank separator line',
    'it should print every line verbatim, with no clipping',
  ].join(', '),
  () => {
    // given
    const { tracer, messages } = tracedMessages()
    const console_ = createConsole(tracer, 'aaaa1111')

    // when
    console_.instructions([
      'just crust report aaaa1111',
      '',
      'to see what happened',
    ])

    // then
    expect(messages).toContain('  just crust report aaaa1111')
    expect(messages).toContain('  to see what happened')
  },
)

test(
  [
    'given use-cases/report-to-console::createConsole',
    'when an agent starts and finishes',
    'it should print its model and session id, then its usage',
  ].join(', '),
  () => {
    // given
    const { tracer, messages } = tracedMessages()
    const console_ = createConsole(tracer, 'aaaa1111')

    // when
    console_.agentStarted('technical-architect', 'claude-sonnet', 'session-1')
    console_.agentFinished('technical-architect', 1200, 0.05)

    // then
    expect(messages.some((line) => line.includes('session session-1'))).toBe(
      true,
    )
    expect(messages.some((line) => line.includes('1,200 tokens'))).toBe(true)
  },
)

test(
  [
    'given use-cases/report-to-console::createConsole',
    'when a retry is reported',
    'it should name the agent, the attempt, the limit and the reason, same session',
  ].join(', '),
  () => {
    // given
    const { tracer, messages } = tracedMessages()
    const console_ = createConsole(tracer, 'aaaa1111')

    // when
    console_.retry('technical-architect', 2, 3, 'the gate failed')

    // then
    expect(messages.some((line) => line.includes('retry 2/3'))).toBe(true)
    expect(messages.some((line) => line.includes('the gate failed'))).toBe(true)
  },
)

test(
  [
    'given use-cases/report-to-console::createConsole',
    'when a gate result reports a failed check with a note',
    'it should print the gate summary and every check, including the note',
  ].join(', '),
  () => {
    // given
    const { tracer, messages } = tracedMessages()
    const console_ = createConsole(tracer, 'aaaa1111')
    const report: TGateReport = {
      checks: [
        { item: 'src/add.ts', ok: false, note: 'no test covers this path' },
        { item: 'src/sub.ts', ok: true, note: '' },
      ],
    } as unknown as TGateReport

    // when
    console_.gateResult('checks', report)

    // then
    expect(messages.some((line) => line.includes('1 of 2 failed'))).toBe(true)
    expect(
      messages.some((line) => line.includes('no test covers this path')),
    ).toBe(true)
  },
)

test(
  [
    'given use-cases/report-to-console::createConsole',
    'when a gate result reports every check passed',
    'it should summarise as checked rather than as a failure count',
  ].join(', '),
  () => {
    // given
    const { tracer, messages } = tracedMessages()
    const console_ = createConsole(tracer, 'aaaa1111')
    const report: TGateReport = {
      checks: [{ item: 'src/add.ts', ok: true, note: '' }],
    } as unknown as TGateReport

    // when
    console_.gateResult('checks', report)

    // then
    expect(messages.some((line) => line.includes('1 checked'))).toBe(true)
  },
)

test(
  [
    'given use-cases/report-to-console::createConsole',
    'when narrate is called for the model\u2019s thinking channel',
    'it should print a thinking header, then the text wrapped under it',
  ].join(', '),
  () => {
    // given
    const { tracer, messages } = tracedMessages()
    const console_ = createConsole(tracer, 'aaaa1111')

    // when
    console_.narrate('technical-architect', 'thinking', 'weighing two options')

    // then
    expect(
      messages.some((line) => line.includes('technical-architect thinking')),
    ).toBe(true)
    expect(messages.some((line) => line.includes('weighing two options'))).toBe(
      true,
    )
  },
)

test(
  [
    'given use-cases/report-to-console::createConsole',
    'when narrate is called for the model\u2019s ordinary voice',
    'it should print the agent\u2019s own name as the header',
  ].join(', '),
  () => {
    // given
    const { tracer, messages } = tracedMessages()
    const console_ = createConsole(tracer, 'aaaa1111')

    // when
    console_.narrate('technical-architect', 'text', 'here is the plan')

    // then
    expect(messages.some((line) => line === '  > technical-architect')).toBe(
      true,
    )
    expect(messages.some((line) => line.includes('here is the plan'))).toBe(
      true,
    )
  },
)

test(
  [
    'given use-cases/report-to-console::createConsole',
    'when envelopeSummary is printed for a failed envelope with artifacts',
    'it should print the failure mark, the summary, and the artifact list',
  ].join(', '),
  () => {
    // given
    const { tracer, messages } = tracedMessages()
    const console_ = createConsole(tracer, 'aaaa1111')
    const envelope = {
      status: 'fail',
      summary: 'could not reproduce the bug',
      artifacts: ['notes.md'],
    } as unknown as TEnvelopeBase

    // when
    console_.envelopeSummary('DiagnosisOutput', envelope)

    // then
    expect(
      messages.some((line) => line.includes('could not reproduce the bug')),
    ).toBe(true)
    expect(messages.some((line) => line.includes('artifacts: notes.md'))).toBe(
      true,
    )
  },
)
