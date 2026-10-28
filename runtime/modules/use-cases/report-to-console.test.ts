import { expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crustConfigSchema } from '../typedefs/config'
import type { TEnvelopeBase } from '../typedefs/envelope'
import type { TRun } from '../typedefs/run'
import type { TTracer } from '../typedefs/trace'
import { checks } from './gates/checks-gate'
import { createConsole } from './report-to-console'

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
      filed.filter((event) => event.name === name).map((event) => event.payload ?? {}),
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
    const console_ = createConsole(tracer, run.runId)
    console_.sessionFinished(true, 0, 0, '/tmp/crust.db')

    // then — the end-of-run report names the uncovered path, in the same
    // channel the other tree warnings use
    expect(messages.some((line) => line.includes('src/add.ts'))).toBe(true)
  },
)
