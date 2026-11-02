import { expect, test } from 'bun:test'
import type { Envelope, Event as EventRow } from '../../shared/types'
import { activityRunLedger, needsYou, runLedger } from './ledger'

const envelope = (
  over: Partial<Envelope> & { payload: Record<string, unknown> },
): Envelope => ({
  envelope_id: 'e1',
  run_id: 'r1',
  activity_run_id: 'p1',
  agent: 'analyst',
  output_type: 'ContextEnvelope',
  payload_json: JSON.stringify(over.payload),
  valid: 1,
  created_at: null,
  ...over,
})

const event = (over: Partial<EventRow>): EventRow => ({
  rowid: 1,
  event_id: 'ev1',
  run_id: 'r1',
  activity_run_id: 'p1',
  parent_id: null,
  type: 'log',
  name: null,
  payload_json: null,
  tokens: null,
  started_at: null,
  ended_at: null,
  ...over,
})

const question = (over: Record<string, unknown> = {}) => ({
  question: 'span-tagged or interval?',
  consequential: true,
  beyond_this_run: false,
  provisional_answer: 'interval, because the query reads ranges',
  ...over,
})

test(
  [
    'given lib/ledger::activityRunLedger',
    'when the activityRun wrote decisions and assumptions',
    'it should carry both across with their reasons attached',
  ].join(', '),
  () => {
    // given — a rationale without its decision is gossip, so they travel together
    const envelopes = [
      envelope({
        payload: {
          decisions: [
            {
              decision: 'scoped to goals 1 and 2',
              rationale: 'the rest are TODO',
            },
          ],
          assumptions: [
            {
              assumption: '3am UTC is a guess',
              invalidated_by: "the provider's docs",
            },
          ],
          unresolved: [],
        },
      }),
    ]

    // when
    const actual = activityRunLedger('p1', envelopes, [])

    // then
    expect(actual.decisions[0]?.rationale).toBe('the rest are TODO')
    expect(actual.assumptions[0]?.invalidated_by).toBe("the provider's docs")
    expect(actual.total).toBe(2)
  },
)

test(
  [
    'given lib/ledger::activityRunLedger',
    'when the run recorded that the activity answered its own question',
    'it should mark that question decided, whatever its flags say',
  ].join(', '),
  () => {
    // given — the event is what happened; the flags are only what the activity
    // claimed before the dial was consulted
    const envelopes = [envelope({ payload: { unresolved: [question()] } })]
    const events = [
      event({
        name: 'self_answered',
        payload_json: JSON.stringify({
          stage: 'design',
          question: 'span-tagged or interval?',
          answer: 'interval',
        }),
      }),
    ]

    // when
    const actual = activityRunLedger('p1', envelopes, events)

    // then
    expect(actual.questions[0]?.outcome).toBe('decided')
  },
)

test(
  [
    'given lib/ledger::activityRunLedger',
    'when the activityRun opened a human gate',
    'it should mark its unanswered question escalated rather than decided',
  ].join(', '),
  () => {
    // given
    const envelopes = [
      envelope({
        payload: { unresolved: [question({ provisional_answer: '' })] },
      }),
    ]
    const events = [
      event({
        name: 'human_gate_open',
        payload_json: JSON.stringify({ stage: 'design', kind: 'escalated' }),
      }),
    ]

    // when
    const actual = activityRunLedger('p1', envelopes, events)

    // then
    expect(actual.questions[0]?.outcome).toBe('escalated')
  },
)

test(
  [
    'given lib/ledger::activityRunLedger',
    'when the chain ended with questions nobody was asked to answer',
    'it should mark them open, which is neither decided nor blocking',
  ].join(', '),
  () => {
    // given — the last activity has no successor to invent anything, so its
    // questions are a finding rather than a gate
    const envelopes = [envelope({ payload: { unresolved: [question()] } })]
    const events = [
      event({
        name: 'open_questions',
        payload_json: JSON.stringify({
          stage: 'review',
          questions: ['span-tagged or interval?'],
        }),
      }),
    ]

    // when
    const actual = activityRunLedger('p1', envelopes, events)

    // then
    expect(actual.questions[0]?.outcome).toBe('open')
  },
)

test(
  [
    'given lib/ledger::activityRunLedger',
    'when no event mentions a question and the activity offered no answer',
    'it should treat it as open rather than as something already settled',
  ].join(', '),
  () => {
    // given — an empty provisional answer is the one thing that must never
    // read as a decision: nobody decided anything
    const envelopes = [
      envelope({
        payload: { unresolved: [question({ provisional_answer: '' })] },
      }),
    ]

    // when
    const actual = activityRunLedger('p1', envelopes, [])

    // then
    expect(actual.questions[0]?.outcome).toBe('open')
  },
)

test(
  [
    'given lib/ledger::activityRunLedger',
    'when a activityRun had its JSON corrected and only the later one validated',
    'it should read the valid envelope rather than the rejected one',
  ].join(', '),
  () => {
    // given — an invalid attempt records the correction loop, not what the
    // activity held
    const envelopes = [
      envelope({
        envelope_id: 'bad',
        valid: 0,
        payload: { decisions: [{ decision: 'rejected', rationale: '' }] },
      }),
      envelope({
        envelope_id: 'good',
        valid: 1,
        payload: {
          decisions: [{ decision: 'accepted', rationale: 'evidence' }],
        },
      }),
    ]

    // when
    const actual = activityRunLedger('p1', envelopes, [])

    // then
    expect(actual.decisions[0]?.decision).toBe('accepted')
  },
)

test(
  [
    'given lib/ledger::activityRunLedger',
    'when the payload is not valid JSON',
    'it should return an empty ledger rather than throwing at render time',
  ].join(', '),
  () => {
    // given — the payload is written by a model, so a broken one is a row to
    // skip and never a blank screen
    const envelopes: Envelope[] = [
      { ...envelope({ payload: {} }), payload_json: '{not json' },
    ]

    // when
    const actual = activityRunLedger('p1', envelopes, [])

    // then
    expect(actual.total).toBe(0)
  },
)

test(
  [
    'given lib/ledger::activityRunLedger',
    'when events belong to a different activity-run',
    'it should ignore them rather than attributing them to this one',
  ].join(', '),
  () => {
    // given — callers pass the whole run's events, so the filtering has to
    // live here or every call site has to remember it.
    //
    // The question carries NO provisional answer on purpose. With one, the
    // fallback would land on 'decided' anyway and this test would pass
    // whether or not the filtering worked.
    const envelopes = [
      envelope({
        payload: { unresolved: [question({ provisional_answer: '' })] },
      }),
    ]
    const foreign = [
      event({
        activity_run_id: 'p2',
        name: 'self_answered',
        payload_json: JSON.stringify({ question: 'span-tagged or interval?' }),
      }),
    ]

    // when
    const ignored = activityRunLedger('p1', envelopes, foreign)
    const attributed = activityRunLedger(
      'p1',
      envelopes,
      foreign.map((row) => ({ ...row, activity_run_id: 'p1' })),
    )

    // then
    expect(ignored.questions[0]?.outcome).toBe('open')
    expect(attributed.questions[0]?.outcome).toBe('decided')
  },
)

test(
  [
    'given lib/ledger::needsYou',
    'when a activityRun decided everything it raised',
    'it should count nothing, because nobody is being asked for anything',
  ].join(', '),
  () => {
    // given — a badge that counts settled decisions cries wolf on every activity
    const ledger = activityRunLedger(
      'p1',
      [
        envelope({
          payload: {
            assumptions: [{ assumption: 'a', invalidated_by: 'b' }],
            unresolved: [question()],
          },
        }),
      ],
      [
        event({
          name: 'self_answered',
          payload_json: JSON.stringify({
            question: 'span-tagged or interval?',
          }),
        }),
      ],
    )

    // when
    const actual = needsYou(ledger)

    // then
    expect(actual).toBe(0)
  },
)

test(
  [
    'given lib/ledger::runLedger',
    'when several activityRuns are asked for at once',
    'it should key each ledger by its own activityRun and leave empty ones empty',
  ].join(', '),
  () => {
    // given
    const envelopes = [
      envelope({
        activity_run_id: 'p1',
        payload: { unresolved: [question()] },
      }),
    ]

    // when
    const actual = runLedger(['p1', 'p2'], envelopes, [])

    // then
    expect(actual.get('p1')?.questions.length).toBe(1)
    expect(actual.get('p2')?.total).toBe(0)
  },
)
