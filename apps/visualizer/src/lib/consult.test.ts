import { expect, test } from 'bun:test'
import {
  consultsFor,
  consultsOf,
  staleAfterAmend,
  type TConsult,
} from './consult'
import type { EventRow, ActivityRun } from './types'

const RUN = 'c35f2c7d'

const consultEvent = (
  activityRunId: string,
  payload: Readonly<Record<string, unknown>>,
): EventRow =>
  ({
    rowid: 1,
    event_id: `evt_${activityRunId}`,
    run_id: RUN,
    activity_run_id: activityRunId,
    parent_id: null,
    type: 'consult',
    name: 'agent ask',
    payload_json: JSON.stringify(payload),
    tokens: null,
    started_at: null,
    ended_at: null,
  }) as EventRow

const activityRun = (seq: number, name: string, endedAt: string): ActivityRun =>
  ({
    activity_run_id: `${RUN}_0${seq}_${name}`,
    run_id: RUN,
    seq,
    name,
    kind: 'agent',
    owner: name,
    description: '',
    status: 'success',
    error: null,
    started_at: endedAt,
    ended_at: endedAt,
  }) as ActivityRun

test(
  [
    'given lib/consult::consultsOf',
    'when a step has been asked a question',
    'it should read the thread without the machinery around it',
  ].join(', '),
  () => {
    // given — the record holds what the person typed. The preamble that
    // tells the agent which mode this is rides in the argv instead, so
    // nothing here has to guess where machinery ended and the question
    // began — a guess that eats the first paragraph of a long one.
    const events = [
      consultEvent(`${RUN}_05_design`, {
        mode: 'ask',
        agent: 'technical-architect',
        question: 'why a registry?\n\nand what about the audit table?',
        answer: 'because identity has to outlive a row.',
        answered: true,
        amended: [],
        restored: [],
        at: '2026-10-06T23:49:37.031Z',
      }),
    ]

    // when
    const actual = consultsOf(events)

    // then
    // the whole question, including a second paragraph a preamble-stripper
    // would have eaten
    expect(actual[0]?.question).toEqual(
      'why a registry?\n\nand what about the audit table?',
    )
    expect(actual[0]?.mode).toEqual('ask')
    expect(actual[0]?.answer).toEqual('because identity has to outlive a row.')
  },
)

test(
  [
    'given lib/consult::staleAfterAmend',
    'when a step amends a document after later steps already ran',
    'it should mark those later steps and leave the earlier ones alone',
  ].join(', '),
  () => {
    // given — the honest cost of amending: the plan was derived from the
    // design as it read BEFORE the change, and nothing else records that
    const activityRuns = [
      activityRun(4, 'conceptualize', '2026-10-06T10:00:00Z'),
      activityRun(5, 'design', '2026-10-06T11:00:00Z'),
      activityRun(6, 'plan', '2026-10-06T12:00:00Z'),
    ]
    const consults: readonly TConsult[] = [
      {
        activityRunId: `${RUN}_05_design`,
        mode: 'amend',
        agent: 'technical-architect',
        question: 'shorten the migration section',
        answer: 'done',
        answered: true,
        amended: ['context_handoff/design.md'],
        restored: [],
        at: '2026-10-06T13:00:00Z',
      },
    ]

    // when
    const actual = staleAfterAmend(consults, activityRuns)

    // then — the plan ran before the amendment and is stale; conceptualize
    // came first and cannot have depended on it
    expect([...actual]).toEqual([`${RUN}_06_plan`])
  },
)

test(
  [
    'given lib/consult::staleAfterAmend',
    'when a step ran after the amendment',
    'it should not be marked, because it already saw the new text',
  ].join(', '),
  () => {
    // given — a replay following an amend is the ordinary way to resolve
    // staleness, and marking it afterwards would make the flag permanent
    const activityRuns = [activityRun(5, 'design', '2026-10-06T11:00:00Z'), activityRun(6, 'plan', '2026-10-06T14:00:00Z')]
    const consults: readonly TConsult[] = [
      {
        activityRunId: `${RUN}_05_design`,
        mode: 'amend',
        agent: 'technical-architect',
        question: 'shorten it',
        answer: 'done',
        answered: true,
        amended: ['context_handoff/design.md'],
        restored: [],
        at: '2026-10-06T13:00:00Z',
      },
    ]

    // when
    const actual = staleAfterAmend(consults, activityRuns)

    // then
    expect([...actual]).toEqual([])
  },
)

test(
  [
    'given lib/consult::staleAfterAmend and consultsFor',
    'when the consult only asked a question',
    'it should mark nothing, and the thread belongs to its own step',
  ].join(', '),
  () => {
    // given — an ask changes no document, so nothing downstream can be
    // derived from something that moved
    const activityRuns = [activityRun(5, 'design', '2026-10-06T11:00:00Z'), activityRun(6, 'plan', '2026-10-06T12:00:00Z')]
    const consults = consultsOf([
      consultEvent(`${RUN}_05_design`, {
        mode: 'ask',
        agent: 'technical-architect',
        question: 'preamble\n\nwhy?',
        answer: 'because.',
        answered: true,
        at: '2026-10-06T13:00:00Z',
      }),
    ])

    // when
    const actual = [
      [...staleAfterAmend(consults, activityRuns)].length,
      consultsFor(consults, `${RUN}_05_design`).length,
      consultsFor(consults, `${RUN}_06_plan`).length,
    ]

    // then
    expect(actual).toEqual([0, 1, 0])
  },
)
