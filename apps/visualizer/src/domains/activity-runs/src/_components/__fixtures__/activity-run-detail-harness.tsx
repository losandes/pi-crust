/**
 * Mounts one real `ActivityRunDetail` so `ActivityRunDetail.layout.test.ts`
 * can measure actual rendered geometry in a real browser. Not shipped; loaded
 * only by that test's in-memory Vite server.
 */

import type { ActivityRun, Envelope, Event, GateResult } from '@shared/types'
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { z } from 'zod'
import '@fontsource/play/400.css'
import '@fontsource/play/700.css'
import '@/style.css'
import DefaultLayout from '@/layouts/default-layout'
import { ActivityRunDetail } from '../ActivityRunDetail'
import { TreeWarnings } from '../TreeWarnings'

const now = Date.parse('2026-06-01T12:00:00Z')

const activityRun: ActivityRun = {
  activity_run_id: 'ar-diag-1',
  run_id: 'run-diag-1',
  seq: 1,
  name: 'build',
  kind: 'agent',
  owner: 'builder',
  description:
    'Keep every detail readable, even when the panel is narrower than the page.',
  status: 'success',
  error: '',
  started_at: new Date(now - 60_000).toISOString(),
  ended_at: new Date(now).toISOString(),
}

const secondActivityRun: ActivityRun = {
  ...activityRun,
  activity_run_id: 'ar-diag-2',
  seq: 2,
  name: 'review',
}

const gatesVariant = new URLSearchParams(window.location.search).get('gates')

const longPath = `src/${'long-directory/'.repeat(12)}activity.tsx`
const events: readonly Event[] = (
  [
    {
      type: 'agent_start',
      name: 'builder',
      payload: {
        coding_agent: 'pi',
        model: 'claude-sonnet-4-6',
        thinking: 'high',
        tools: ['read', 'edit', 'bash'],
        harness_engineering: ['guard-paths'],
        purpose: 'Preserve the details in a parent-sized panel',
        session_id: 'fixture-session-with-a-long-identifier',
      },
    },
    {
      type: 'tool_call',
      name: 'read',
      payload: {
        tool: 'read',
        ok: true,
        args: { path: longPath },
        result_snippet: 'A rendered tool result',
        duration_ms: 15,
      },
    },
    {
      type: 'tool_call',
      name: 'bash',
      payload: {
        tool: 'bash',
        ok: false,
        args: { command: 'check' },
        result_snippet: 'A failed tool result',
        duration_ms: 25,
      },
    },
    {
      type: 'log',
      name: 'tree_warning',
      payload: {
        kind: 'unexpected',
        activities: ['build'],
        activity_run_ids: ['ar-diag-1'],
        stage: 'build',
        paths: [longPath],
        note: 'A developer saved this file.',
      },
    },
    {
      type: 'agent_end',
      name: 'builder',
      payload: {
        usage: {
          input_tokens: 1000,
          output_tokens: 200,
          reasoning_tokens: 100,
          cache_read_tokens: 20,
          cache_write_tokens: 30,
          total_tokens: 1250,
          input_cost: 0.01,
          output_cost: 0.02,
          cache_read_cost: 0.001,
          cache_write_cost: 0.002,
          total_cost: 0.033,
        },
      },
    },
  ] as const
).map(({ payload, ...event }, index) => ({
  ...event,
  rowid: index + 1,
  event_id: `detail-event-${index}`,
  run_id: activityRun.run_id,
  activity_run_id: activityRun.activity_run_id,
  parent_id: '',
  payload_json: JSON.stringify(payload),
  tokens: 1250,
  started_at: activityRun.started_at,
  ended_at: activityRun.ended_at,
}))

const createGate = (
  id: number,
  selected: Readonly<ActivityRun>,
  gate: string,
  passed: GateResult['passed'],
): GateResult => ({
  id,
  run_id: selected.run_id,
  activity_run_id: selected.activity_run_id,
  gate,
  passed,
  violations_json: JSON.stringify(passed ? [] : ['One check failed']),
  checks_json: JSON.stringify([
    { item: 'source.tsx', ok: true, note: 'Verified' },
    {
      item: longPath,
      ok: Boolean(passed),
      note: passed ? 'Verified' : 'check exited 1\nEvidence on another line',
    },
  ]),
  created_at: selected.ended_at,
})

const gates: readonly GateResult[] = [
  ...(gatesVariant === 'none'
    ? []
    : gatesVariant === 'unrecorded'
      ? [createGate(1, activityRun, 'schema', null)]
      : [
          createGate(1, activityRun, 'schema', 1),
          createGate(
            2,
            activityRun,
            'checks',
            gatesVariant === 'passed' ? 1 : 0,
          ),
        ]),
  createGate(3, secondActivityRun, 'checks', 0),
]

const envelopes: readonly Envelope[] = [true, false].map((valid, index) => ({
  envelope_id: `detail-envelope-${index}`,
  run_id: activityRun.run_id,
  activity_run_id: activityRun.activity_run_id,
  agent: 'builder',
  output_type: 'BuildOutput',
  valid: valid ? 1 : 0,
  payload_json: JSON.stringify({
    summary: 'Rendered details',
    facts: [],
    decisions: [],
    assumptions: [],
    unresolved: [],
    risks: [],
  }),
  created_at: activityRun.ended_at,
}))

/** `detail` of the `activity-run-harness` CustomEvent, merged over current state. */
const harnessControlSchema = z.object({
  messages: z.number().int().nonnegative().optional(),
  kind: z.enum(['agent', 'code']).optional(),
  activityRunId: z.string().optional(),
  /** Turn numbers within 1..messages that call one tool and narrate nothing. */
  silentTurns: z.array(z.number().int().positive()).optional(),
  /** One steer, sent 500 ms after this turn began. */
  steerAfterTurn: z.number().int().positive().optional(),
})
type THarnessControl = Readonly<z.infer<typeof harnessControlSchema>>

const Harness = () => {
  const [selected, setSelected] = useState(activityRun)
  const [recordedGates, setRecordedGates] = useState(gates)

  useEffect(() => {
    const selectActivity = (event: globalThis.Event) => {
      if (!(event instanceof CustomEvent)) return
      if (event.detail === activityRun.activity_run_id) setSelected(activityRun)
      if (event.detail === secondActivityRun.activity_run_id)
        setSelected(secondActivityRun)
    }
    const recordFailedGate = () =>
      setRecordedGates((current) => [
        ...current,
        createGate(
          Math.max(0, ...current.map((gate) => gate.id)) + 1,
          selected,
          'checks',
          0,
        ),
      ])
    window.addEventListener('fixture:select-activity', selectActivity)
    window.addEventListener('fixture:record-failed-gate', recordFailedGate)
    return () => {
      window.removeEventListener('fixture:select-activity', selectActivity)
      window.removeEventListener('fixture:record-failed-gate', recordFailedGate)
    }
  }, [selected])

  const [control, setControl] = useState<THarnessControl>({ messages: 0 })
  useEffect(() => {
    const update = (event: globalThis.Event) => {
      if (!(event instanceof CustomEvent)) return
      const parsed = harnessControlSchema.safeParse(event.detail)
      if (!parsed.success) return
      const detail: THarnessControl = parsed.data
      setControl((current) => ({
        messages: detail.messages ?? current.messages,
        kind: detail.kind ?? current.kind,
        activityRunId: detail.activityRunId ?? current.activityRunId,
        silentTurns: detail.silentTurns ?? current.silentTurns,
        steerAfterTurn: detail.steerAfterTurn ?? current.steerAfterTurn,
      }))
    }
    window.addEventListener('activity-run-harness', update)
    return () => window.removeEventListener('activity-run-harness', update)
  }, [])
  const currentActivityRun = {
    ...selected,
    kind: control.kind ?? selected.kind,
    activity_run_id: control.activityRunId ?? selected.activity_run_id,
  }
  const turnTime = (turn: number, offset = 0) =>
    new Date(
      Date.parse(activityRun.started_at ?? '') + turn * 1000 + offset,
    ).toISOString()
  const currentEvents: readonly Event[] = [
    ...events,
    ...Array.from({ length: control.messages ?? 0 }, (_, index): Event => {
      const turn = index + 1
      const silent = control.silentTurns?.includes(turn) ?? false
      return {
        rowid: events.length + turn,
        event_id: `detail-${silent ? 'silent' : 'message'}-${turn}`,
        run_id: activityRun.run_id,
        activity_run_id: currentActivityRun.activity_run_id,
        parent_id: '',
        type: silent ? 'tool_call' : 'narration',
        name: silent ? `bash: silent turn ${turn}` : 'builder',
        payload_json: JSON.stringify(
          silent
            ? {
                turn,
                tool: 'bash',
                ok: true,
                args: { command: `silent turn ${turn}` },
                result_snippet: '',
                duration_ms: 1,
              }
            : {
                turn,
                channel: 'text',
                text: `message ${turn}`,
              },
        ),
        tokens: 0,
        started_at: turnTime(turn),
        ended_at: turnTime(turn),
      }
    }),
    ...(control.steerAfterTurn === undefined
      ? []
      : [
          {
            rowid: events.length + (control.messages ?? 0) + 1,
            event_id: 'detail-steer',
            run_id: activityRun.run_id,
            activity_run_id: currentActivityRun.activity_run_id,
            parent_id: '',
            type: 'log' as const,
            name: 'inbox_steer',
            payload_json: JSON.stringify({
              kind: 'steer',
              message: 'steer note',
              from: 'alice',
            }),
            tokens: 0,
            started_at: turnTime(control.steerAfterTurn, 500),
            ended_at: turnTime(control.steerAfterTurn, 500),
          },
        ]),
  ].map((event) => ({
    ...event,
    activity_run_id: control.activityRunId ?? event.activity_run_id,
  }))

  return (
    <DefaultLayout>
      <ActivityRunDetail
        activityRun={currentActivityRun}
        runId="run-diag-1"
        runStatus="success"
        events={currentEvents}
        envelopes={envelopes.map((envelope) => ({
          ...envelope,
          activity_run_id: control.activityRunId ?? envelope.activity_run_id,
        }))}
        gates={recordedGates.map((gate) => ({
          ...gate,
          activity_run_id: control.activityRunId ?? gate.activity_run_id,
        }))}
        activityRuns={[currentActivityRun]}
        onClose={() => {}}
      />
      <TreeWarnings
        standalone
        warnings={[
          {
            kind: 'unexpected',
            activities: ['build'],
            activityRunIds: ['ar-diag-1'],
            stage: 'build',
            paths: [longPath],
            note: 'A developer saved this file.',
          },
        ]}
      />
    </DefaultLayout>
  )
}

const el = document.getElementById('root')
if (el) createRoot(el).render(<Harness />)
