import { expect, test } from 'bun:test'
import type { TEnvelopeBase } from '../typedefs/envelope'
import type { TStepContext } from '../typedefs/step'
import { chainNote, plannedChain } from './operator-plan'

const envelope = (steps: readonly unknown[]): TEnvelopeBase =>
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
    steps,
  }) as unknown as TEnvelopeBase

const contextOf = (
  previousStep: string | undefined,
  previous: TEnvelopeBase | undefined,
): TStepContext =>
  ({
    previousStep,
    previous,
    prompt: '',
    baseline: '',
    outcomes: [],
  }) as unknown as TStepContext

test(
  [
    'given use-cases/operator-plan::plannedChain',
    'when an operator phase chose a chain',
    'it should return that chain in the order it was planned',
  ].join(' '),
  () => {
    // given
    const ctx = contextOf('operator', envelope(['identify', 'plan', 'build']))

    // when
    const chain = plannedChain(ctx)

    // then
    expect(chain).toEqual(['identify', 'plan', 'build'])
  },
)

test(
  [
    'given use-cases/operator-plan::plannedChain',
    'when the previous step was anything other than an operator',
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
    'when a trace holds a step name this factory no longer has',
    'it should drop it rather than fail the resumed run',
  ].join(' '),
  () => {
    // given
    const ctx = contextOf('operator', envelope(['plan', 'retired-step', 'build']))

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
    'it should name every step, because that is what is about to be paid for',
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
