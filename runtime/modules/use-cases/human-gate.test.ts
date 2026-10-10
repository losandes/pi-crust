import { expect, test } from 'bun:test'
import type { TEnvelopeBase } from '../typedefs/envelope'
/*
 * The conservative band, spelled out. These cases are about what a GATE does
 * with a consequential question, which is only observable below 50 — above
 * it the dial answers reversible ones before a gate is ever consulted.
 */
const CAUTIOUS = 20
import { TRUST_DEFAULT } from '../typedefs/trust'
import {
  blockingQuestions,
  gateReason,
  selfAnswered,
  parseApproveAfter,
  renderDecisionRequest,
  resumeInvocation,
} from './human-gate'

/** A context envelope carrying questions, with sane defaults per question. */
const envelope = (
  unresolved: readonly Readonly<{
    question: string
    consequential: boolean
    beyond_this_run?: boolean
    provisional_answer?: string
  }>[],
): TEnvelopeBase =>
  ({
    status: 'success',
    summary: 'did the thing',
    artifacts: [],
    notes_for_next_agent: '',
    facts: [],
    decisions: [],
    assumptions: [],
    unresolved: unresolved.map((question) => ({
      beyond_this_run: false,
      provisional_answer: '',
      ...question,
    })),
    risks: [],
    objective_met: { met: true, evidence: 'checked' },
    regress_to: { stage: '', because: '' },
  }) as unknown as TEnvelopeBase

test(
  [
    'given use-cases/human-gate::gateReason',
    'when nothing was gated and nothing is consequential',
    'it should let the chain carry on',
  ].join(', '),
  () => {
    // given
    const stage = 'plan'

    // when
    const actual = gateReason({
      stage,
      envelope: envelope([{ question: 'what colour?', consequential: false }]),
      approveAfter: [],
      hasSuccessor: true,
      trust: CAUTIOUS,
    })

    // then
    expect(actual).toBeUndefined()
  },
)

test(
  [
    'given use-cases/human-gate::gateReason',
    'when the developer asked to approve this stage',
    'it should stop after it, not before it',
  ].join(', '),
  () => {
    // given
    const stage = 'design'

    // when
    const actual = gateReason({
      stage,
      envelope: envelope([]),
      approveAfter: ['identify', 'design'],
      hasSuccessor: true,
      trust: CAUTIOUS,
    })

    // then — the named stage RAN; the chain stops before the next one
    expect(actual).toEqual({ kind: 'requested', stage: 'design' })
  },
)

test(
  [
    'given use-cases/human-gate::gateReason',
    'when a stage left a consequential question',
    'it should stop even though nobody asked it to',
  ].join(', '),
  () => {
    // given a question a later stage would have to invent the answer to
    const unresolved = [
      { question: 'how long is data retained?', consequential: true },
      { question: 'what should the button say?', consequential: false },
    ]

    // when
    const actual = gateReason({
      stage: 'identify',
      envelope: envelope(unresolved),
      approveAfter: [],
      hasSuccessor: true,
      trust: CAUTIOUS,
    })

    // then — the Authority Rule: a decision nobody is entitled to make
    expect(actual).toEqual({
      kind: 'escalated',
      stage: 'identify',
      questions: ['how long is data retained?'],
    })
  },
)

test(
  [
    'given use-cases/human-gate::consequentialQuestions',
    'when the envelope is a code phase output with no context',
    'it should find nothing rather than fail',
  ].join(', '),
  () => {
    // given
    const verify = {
      status: 'success',
      summary: 'checks ran',
      passed: true,
      failures: [],
    } as unknown as TEnvelopeBase

    // when
    const actual = blockingQuestions(verify, CAUTIOUS)

    // then
    expect(actual).toEqual([])
  },
)

test(
  [
    'given use-cases/human-gate::parseApproveAfter',
    'when the flag lists stages with stray whitespace',
    'it should read the names and drop the gaps',
  ].join(', '),
  () => {
    // given
    const flag = ' identify , design ,, '

    // when
    const actual = parseApproveAfter(flag)

    // then
    expect(actual).toEqual(['identify', 'design'])
  },
)

test(
  [
    'given use-cases/human-gate::renderDecisionRequest',
    'when a run stops for a consequential question',
    'it should tell the reader nothing is running and how to answer',
  ].join(', '),
  () => {
    // given
    const reason = {
      kind: 'escalated',
      stage: 'identify',
      questions: ['how long is data retained?'],
    } as const

    // when
    const actual = renderDecisionRequest(
      reason,
      'a1b2c3d4',
      'bun .pi-crust/lifecycles/sdlc.ts spec.md --approve-after plan --run-id a1b2c3d4 --resume',
    )

    // then
    expect(actual).toContain('how long is data retained?')
    expect(actual).toContain('just crust approve a1b2c3d4')
    expect(actual).toContain('Nothing is running')
    // and the way back in, with the flags this run was launched with
    expect(actual).toContain('--approve-after plan --run-id a1b2c3d4 --resume')
  },
)

test(
  [
    'given use-cases/human-gate::gateReason',
    'when the LAST stage leaves a consequential question',
    'it should report it rather than stopping a chain that has already finished',
  ].join(', '),
  () => {
    // given — the Authority Rule protects a LATER stage from inventing an
    // answer, and after the last stage there is no later stage
    const stage = 'code-review'

    // when
    const actual = gateReason({
      stage,
      envelope: envelope([
        { question: 'should retention be 30 or 90 days?', consequential: true },
      ]),
      approveAfter: [],
      hasSuccessor: false,
      trust: CAUTIOUS,
    })

    // then — otherwise a completed nine-stage run exits `waiting` and offers a
    // resume command with nothing left to resume
    expect(actual).toBeUndefined()
  },
)

test(
  [
    'given use-cases/human-gate::gateReason',
    'when the last stage is one you asked to approve',
    'it should still stop',
  ].join(', '),
  () => {
    // given — you asked to see that output before anything continued, and
    // "nothing continued" is your answer to give, not the chain's
    const stage = 'code-review'

    // when
    const actual = gateReason({
      stage,
      envelope: envelope([]),
      approveAfter: ['code-review'],
      hasSuccessor: false,
      trust: CAUTIOUS,
    })

    // then
    expect(actual?.kind).toBe('requested')
  },
)

test(
  [
    'given use-cases/human-gate::resumeInvocation',
    'when a run that was launched with flags stops at a gate',
    'it should repeat those flags in the command that picks it up',
  ].join(', '),
  () => {
    // given — `--approve-after` is a property of the INVOCATION and is stored
    // nowhere, so a developer who resumes without it loses the gate they asked
    // for and finds out by the chain sailing past it
    const argv = [
      'bun',
      '/Users/andy/src/app/.pi-crust/lifecycles/sdlc.ts',
      'specs/stats.md',
      '--approve-after',
      'plan',
    ]

    // when
    const actual = resumeInvocation(argv, '9afffac5')

    // then
    expect(actual).toBe(
      'bun .pi-crust/lifecycles/sdlc.ts specs/stats.md --approve-after plan ' +
        '--run-id 9afffac5 --resume',
    )
  },
)

test(
  [
    'given use-cases/human-gate::resumeInvocation',
    'when the run was already a resumed one',
    'it should not stack a second --run-id or a second --resume onto the line',
  ].join(', '),
  () => {
    // given — the second gate of a run that was already picked up once
    const argv = [
      'bun',
      '/Users/andy/src/app/.pi-crust/lifecycles/sdlc.ts',
      'specs/stats.md',
      '--run-id',
      '9afffac5',
      '--resume',
    ]

    // when
    const actual = resumeInvocation(argv, '9afffac5')

    // then
    expect(actual).toBe(
      'bun .pi-crust/lifecycles/sdlc.ts specs/stats.md --run-id 9afffac5 --resume',
    )
  },
)

test(
  [
    'given use-cases/human-gate::resumeInvocation',
    'when the prompt was given inline rather than as a path',
    'it should quote it, because this line exists to be pasted',
  ].join(', '),
  () => {
    // given — one argv entry full of spaces; unquoted it becomes six arguments
    // and the command fails in a way that looks like crust's fault
    const argv = [
      'bun',
      '/Users/andy/src/app/.pi-crust/stages/scout.ts',
      'name the top-level directories. change nothing.',
    ]

    // when
    const actual = resumeInvocation(argv, 'ac3127d9')

    // then
    expect(actual).toBe(
      'bun .pi-crust/stages/scout.ts "name the top-level directories. change ' +
        'nothing." --run-id ac3127d9 --resume',
    )
  },
)

test(
  [
    'given use-cases/human-gate::resumeInvocation',
    'when an argument already contains a quote',
    'it should escape it rather than ending the string early',
  ].join(', '),
  () => {
    // given
    const argv = ['bun', '/app/.pi-crust/stages/plan.ts', 'add a "health" endpoint']

    // when
    const actual = resumeInvocation(argv, 'a1')

    // then
    expect(actual).toContain('"add a \\"health\\" endpoint"')
  },
)

test(
  [
    'given use-cases/human-gate::gateReason',
    'when trust is raised and the question is reversible',
    'it should let the run carry on rather than stopping for it',
  ].join(', '),
  () => {
    // given — a cache window is a constant, and a wrong guess costs a line
    const reversible = envelope([
      {
        question: 'cache for 60s or 300s?',
        consequential: true,
        beyond_this_run: false,
        provisional_answer: '60s, matching the neighbouring endpoint',
      },
    ])

    // when
    const actual = gateReason({
      stage: 'design',
      envelope: reversible,
      approveAfter: [],
      hasSuccessor: true,
      trust: 50,
    })

    // then
    expect(actual).toBeUndefined()
  },
)

test(
  [
    'given use-cases/human-gate::gateReason',
    'when trust is raised but acting would reach beyond this run',
    'it should still stop, even though the stage knows what it would do',
  ].join(', '),
  () => {
    // given — the test is this run's blast radius, not the importance of
    // the subject. Choosing a canonical column in a document is not beyond
    // this run; running the migration that adopts it is.
    const beyond = envelope([
      {
        question: 'shall I run the migration that adopts the uuid column?',
        consequential: true,
        beyond_this_run: true,
        provisional_answer: 'run it against the primary',
      },
    ])

    // when
    const actual = gateReason({
      stage: 'design',
      envelope: beyond,
      approveAfter: [],
      hasSuccessor: true,
      trust: 90,
    })

    // then — a schema decided wrongly is paid for by everyone downstream
    expect(actual?.kind).toBe('escalated')
  },
)

test(
  [
    'given use-cases/human-gate::gateReason',
    'when trust is total',
    'it should not stop even for a question it could not answer',
  ].join(', '),
  () => {
    // given — 100 means "decide it yourself and do not come back", which is
    // the whole point. An unanswered question here is a defect in the
    // report, not a reason to halt.
    const unanswerable = envelope([
      { question: 'which column?', consequential: true, beyond_this_run: true },
    ])

    // when
    const actual = gateReason({
      stage: 'design',
      envelope: unanswerable,
      approveAfter: [],
      hasSuccessor: true,
      trust: 100,
    })

    // then
    expect(actual).toBeUndefined()
  },
)

test(
  [
    'given use-cases/human-gate::gateReason',
    'when trust is total but a gate was explicitly requested',
    'it should still stop, because that gate is the person speaking',
  ].join(', '),
  () => {
    // given — the dial governs what AGENTS decide; --approve-after is you
    const clean = envelope([])

    // when
    const actual = gateReason({
      stage: 'plan',
      envelope: clean,
      approveAfter: ['plan'],
      hasSuccessor: true,
      trust: 100,
    })

    // then
    expect(actual?.kind).toBe('requested')
  },
)

test(
  [
    'given use-cases/human-gate::selfAnswered',
    'when a stage answered its own question under a raised dial',
    'it should report the question AND the answer it chose',
  ].join(', '),
  () => {
    // given — the bargain of a raised dial is seeing what it bought
    const decided = envelope([
      {
        question: 'how long is the retention window?',
        consequential: true,
        beyond_this_run: false,
        provisional_answer: '90 days, matching the sibling service',
      },
    ])

    // when
    const actual = selfAnswered(decided, 60)

    // then
    expect(actual).toEqual([
      {
        question: 'how long is the retention window?',
        answer: '90 days, matching the sibling service',
      },
    ])
  },
)

test(
  [
    'given use-cases/human-gate::selfAnswered',
    'when a stage proceeded with no answer at all',
    'it should say that, rather than reporting an empty string as an answer',
  ].join(', '),
  () => {
    // given — "I carried on without deciding" is the worst case and must be
    // the most visible, not the blankest
    const decided = envelope([
      { question: 'which region?', consequential: true, beyond_this_run: false },
    ])

    // when
    const actual = selfAnswered(decided, 100)

    // then
    expect(actual[0]?.answer).toContain('no answer offered')
  },
)

test(
  [
    'given use-cases/human-gate::gateReason',
    'when the dial is at its default and a consequential question has an answer',
    'it should not stop, which is the complaint this change exists to fix',
  ].join(', '),
  () => {
    // given — every question of this shape stopped a medium run before, and
    // a chain of nine stages stopped at nearly every one of them. A
    // colleague would pick one, say so, and be corrected later.
    const decided = envelope([
      {
        question: 'which temporal model — span-tagged or interval?',
        consequential: true,
        beyond_this_run: false,
        provisional_answer: 'interval, because the reconciliation query reads ranges',
      },
    ])

    // when
    const actual = gateReason({
      stage: 'design',
      envelope: decided,
      approveAfter: [],
      hasSuccessor: true,
      trust: TRUST_DEFAULT,
    })

    // then
    expect(actual).toBeUndefined()
  },
)
