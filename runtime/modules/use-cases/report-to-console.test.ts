import { expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTracer } from '../data/trace-db'
import { activityRunParams } from '../typedefs/activity-run'
import { crustConfigSchema } from '../typedefs/config'
import type { TEnvelopeBase } from '../typedefs/envelope'
import type { TRun } from '../typedefs/run'
import type { TTracer } from '../typedefs/trace'
import { checks } from './gates/checks-gate'
import {
  createConsole,
  PROMPT_BODY_CHARS,
  PROMPT_BODY_LINES,
} from './report-to-console'

/** Asserts stay on the traced copy; this never touches the real terminal. */
const silentWrite = (): void => undefined

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
    const console_ = createConsole(tracer, 'aaaa1111', silentWrite)

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
    const console_ = createConsole(tracer, 'aaaa1111', silentWrite)

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
      filed.filter((event) => event.name === name).map((event) => event.payload ?? {}),
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
            { name: 'lint', when: ['**/*.md'], operation: 'lint', argv: ['true'] },
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
    const console_ = createConsole(tracer, run.runId, silentWrite)
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
    const console_ = createConsole(tracer, 'aaaa2222', silentWrite)
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
    const console_ = createConsole(tracer, 'aaaa1111', silentWrite)
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
    const console_ = createConsole(tracer, 'aaaa1111', silentWrite)
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
    const console_ = createConsole(tracer, 'aaaa1111', silentWrite)

    // when
    expect(() => console_.promptReceived('')).not.toThrow()

    // then
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain('0 chars')
  },
)
