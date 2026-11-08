import { expect, test } from 'bun:test'
import type { TActivityContext, TEnvelopeBase } from '../../../../lib/contracts'
import { chainNote, plannedChain } from './operator-plan'

const envelope = (activities: readonly unknown[]): TEnvelopeBase =>
  ({
    status: 'success',
    summary: '',
    artifacts: [],
    notes_for_next_agent: '',
    facts: [],
    decisions: [],
    assumptions: [],
    unresolved: [],
    risks: [],
    objective_met: { met: true, evidence: '' },
    regress_to: { activity: '', because: '' },
    // the operator envelope's published field name
    steps: activities,
  }) as unknown as TEnvelopeBase

const contextOf = (
  previousStep: string | undefined,
  previous: TEnvelopeBase | undefined,
): TActivityContext =>
  ({
    previousStep,
    previous,
    prompt: '',
    baseline: '',
    outcomes: [],
    feedback: [],
    /*
     * The registry a plan is checked against is the one the RUN loaded, so
     * a chain naming an Activity this repository no longer offers is
     * dropped rather than replayed into a usage error.
     */
    run: {
      cfg: {
        activities: [
          { name: 'plan' },
          { name: 'test' },
          { name: 'build' },
          { name: 'review' },
        ],
      },
    },
  }) as unknown as TActivityContext

test(
  [
    'given use-cases/operator-plan::plannedChain',
    'when an operator activityRun chose a chain',
    'it should return that chain in the order it was planned',
  ].join(' '),
  () => {
    // given
    const ctx = contextOf('operator', envelope(['plan', 'test', 'build']))

    // when
    const chain = plannedChain(ctx)

    // then
    expect(chain).toEqual(['plan', 'test', 'build'])
  },
)

test(
  [
    'given use-cases/operator-plan::plannedChain',
    'when the previous activity was anything other than an operator',
    'it should return nothing, so an ordinary run is never rewritten',
  ].join(' '),
  () => {
    // given — a build envelope could carry a `steps` field of its own
    const ctx = contextOf('build', envelope(['plan', 'build']))

    // when
    const chain = plannedChain(ctx)

    // then
    expect(chain).toEqual([])
  },
)

test(
  [
    'given use-cases/operator-plan::plannedChain',
    'when a trace holds a activity name this factory no longer has',
    'it should drop it rather than fail the resumed run',
  ].join(' '),
  () => {
    // given
    const ctx = contextOf(
      'operator',
      envelope(['plan', 'retired-activity', 'build']),
    )

    // when
    const chain = plannedChain(ctx)

    // then
    expect(chain).toEqual(['plan', 'build'])
  },
)

test(
  [
    'given use-cases/operator-plan::plannedChain',
    'when there is no previous envelope at all',
    'it should return nothing rather than throw',
  ].join(' '),
  () => {
    // given
    const ctx = contextOf('operator', undefined)

    // when
    const chain = plannedChain(ctx)

    // then
    expect(chain).toEqual([])
  },
)

test(
  [
    'given use-cases/operator-plan::chainNote',
    'when a chain is about to run',
    'it should name every activity, because that is what is about to be paid for',
  ].join(' '),
  () => {
    // given
    const chain = ['identify', 'build']

    // when
    const note = chainNote(chain)

    // then
    expect(note).toBe('operator chose: identify -> build')
  },
)
