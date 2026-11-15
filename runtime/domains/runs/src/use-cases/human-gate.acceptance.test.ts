import { expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EXIT } from '../../../../lib/contracts'
import { terminalOutput } from '../../../../testing/terminal-capture'
import {
  acceptanceDecision,
  renderDecisionRequest,
  writeDecisionRequest,
} from './human-gate'
import { gateFixture } from './human-gate-fixture.test'
import { finishWaiting } from './run-activity-run'

const opened = '2026-01-01T00:00:00.000Z'
const later = '2026-01-01T00:00:01.000Z'

for (const scenario of [
  { name: 'no sidecar', record: undefined, valid: false },
  { name: 'malformed JSON', record: '{', valid: false },
  {
    name: 'an unknown verb',
    record: JSON.stringify({ verb: 'continue', at: later, from: 'alice' }),
    valid: false,
  },
  {
    name: 'an invalid timestamp',
    record: JSON.stringify({
      verb: 'approve',
      at: 'not a date',
      from: 'alice',
    }),
    valid: false,
  },
  {
    name: 'an earlier answer',
    record: JSON.stringify({
      verb: 'approve',
      at: '2025-01-01T00:00:00.000Z',
      from: 'alice',
    }),
    valid: false,
  },
  {
    name: 'an answer at gate opening',
    record: JSON.stringify({ verb: 'approve', at: opened, from: 'alice' }),
    valid: false,
  },
  {
    name: 'a fresh approval',
    record: JSON.stringify({ verb: 'approve', at: later, from: 'alice' }),
    valid: true,
  },
  {
    name: 'a fresh answer',
    record: JSON.stringify({ verb: 'answer', at: later, from: 'alice' }),
    valid: true,
  },
  {
    name: 'a fresh rejection',
    record: JSON.stringify({ verb: 'reject', at: later, from: 'alice' }),
    valid: true,
  },
]) {
  test(
    [
      `given an acceptance gate with ${scenario.name} and a newer delivery gate`,
      'when the decision is read',
      'it should validate the answer against the latest acceptance gate only',
    ].join(', '),
    () => {
      // given
      using fixture = gateFixture()
      const { run } = fixture
      run.tracer.event({
        run_id: run.runId,
        type: 'log',
        name: 'human_gate_open',
        payload: {
          kind: 'acceptance',
          activity: 'gh-pull-request',
          detail: 'Unresolved findings',
          opened_at: opened,
        },
      })
      run.tracer.event({
        run_id: run.runId,
        type: 'log',
        name: 'human_gate_open',
        payload: {
          kind: 'delivery',
          opened_at: '2026-01-01T00:00:02.000Z',
        },
      })
      writeFileSync(
        join(run.contextHandoffDir, 'decision-answer.md'),
        'Approved by someone long ago',
      )
      if (scenario.record !== undefined)
        writeFileSync(
          join(run.contextHandoffDir, 'decision-answer.json'),
          scenario.record,
        )

      // when
      const actual = acceptanceDecision(run)

      // then
      expect(actual?.gate.detail).toBe('Unresolved findings')
      expect(actual?.answer !== undefined).toBe(scenario.valid)
      if (scenario.valid) expect(actual?.answer?.from).toBe('alice')
    },
  )
}

test(
  [
    'given a run with no acceptance gate',
    'when its decision is read',
    'it should not bypass the workflow',
  ].join(', '),
  () => {
    // given
    using fixture = gateFixture()

    // when
    const actual = acceptanceDecision(fixture.run)

    // then
    expect(actual).toBeUndefined()
  },
)

test(
  [
    'given a fresh answer to an older acceptance gate',
    'when another acceptance gate opened afterwards',
    'it should require a new answer',
  ].join(', '),
  () => {
    // given
    using fixture = gateFixture()
    const { run } = fixture
    for (const at of [opened, '2026-01-01T00:00:02.000Z']) {
      run.tracer.event({
        run_id: run.runId,
        type: 'log',
        name: 'human_gate_open',
        payload: {
          kind: 'acceptance',
          activity: 'gh-pull-request',
          detail: 'Findings',
          opened_at: at,
        },
      })
    }
    writeFileSync(
      join(run.contextHandoffDir, 'decision-answer.json'),
      JSON.stringify({ verb: 'approve', at: later, from: 'alice' }),
    )

    // when
    const actual = acceptanceDecision(run)

    // then
    expect(actual?.answer).toBeUndefined()
  },
)

test(
  [
    'given an acceptance gate with a settled dispute reason',
    'when the request and waiting console options are rendered',
    'it should explain acceptance and cancellation rather than promise another revise round',
  ].join(', '),
  () => {
    // given
    using fixture = gateFixture()
    const { run } = fixture
    const reason = {
      kind: 'acceptance' as const,
      activity: 'gh-pull-request',
      detail: 'Deadlocked — see handoff/disputes.md',
    }
    const resume = 'just crust run --run-id wait0117 --resume'
    const request = writeDecisionRequest(
      run.contextHandoffDir,
      reason,
      run.runId,
      resume,
    )
    run.tracer.event({
      run_id: run.runId,
      type: 'log',
      name: 'human_gate_open',
      payload: reason,
    })

    // when
    const rendered = renderDecisionRequest(reason, run.runId, resume)
    const exit = finishWaiting(run, request)

    // then
    expect(exit).toBe(EXIT.WAITING)
    expect(readFileSync(request, 'utf8')).toBe(rendered)
    expect(rendered).toContain(reason.detail)
    expect(rendered).toContain(
      'Approve opens the pull request over the unresolved findings',
    )
    expect(rendered).toContain('Reject cancels the pull request')
    expect(rendered).toContain('does not revise the work')
    expect(rendered).toContain(resume)
    const output = terminalOutput()
    expect(output).toContain('just crust approve')
    expect(output).toContain('just crust answer')
    expect(output).toContain('just crust reject')
    expect(output).toContain('cancel the pull request')
    expect(output).not.toContain('send the stage back')
  },
)
