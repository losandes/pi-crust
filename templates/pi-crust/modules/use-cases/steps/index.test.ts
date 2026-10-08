import { expect, test } from 'bun:test'
import { DEFAULT_STEP_OPTIONS, STEP_NAMES } from '../../typedefs/step'
import { requiredAgents, resolveSteps } from './index'

test(
  [
    'given use-cases/steps::resolveSteps',
    'when every step name is asked for',
    'it should resolve each one to a phase of the right kind and owner',
  ].join(', '),
  () => {
    // given
    const names = [...STEP_NAMES]

    // when
    const actual = resolveSteps(names)

    // then
    expect(actual.map((step) => step.params.name)).toEqual(names)
    expect(
      actual.map((step) => `${step.params.kind}:${step.params.owner}`),
    ).toEqual([
      'agent:builder',
      'agent:scout',
      'agent:technical-researcher',
      'agent:ux-researcher',
      'agent:domain-researcher',
      'agent:security-researcher',
      'agent:data-researcher',
      'agent:ux-designer',
      'agent:operator',
      // the same choice, handed back rather than executed
      'agent:advisor',
      'agent:analyst',
      'agent:diagnostician',
      'agent:solutions-architect',
      'agent:planner',
      'agent:technical-architect',
      'agent:builder',
      'agent:tester',
      'agent:builder',
      'code:checks',
      'agent:reviewer',
      'agent:code-reviewer',
      'agent:builder',
      'code:git',
      'agent:documenter',
    ])
  },
)

test(
  [
    'given use-cases/steps::resolveSteps',
    'when no --base was given',
    'it should default to the empty selector so a step can tell that apart from --base main',
  ].join(', '),
  () => {
    // given
    const names = ['document']

    // when
    const actual = resolveSteps(names)

    // then
    expect(actual[0]?.params.owner).toEqual('documenter')
    // document compensates with `ctx.baseline || options.base || 'main'`, so
    // its behaviour is unchanged; verify/review/code-review need the ''.
    expect(DEFAULT_STEP_OPTIONS.base).toEqual('')
  },
)

test(
  [
    'given use-cases/steps::resolveSteps',
    'when a step is named more than once',
    'it should number the repeats so their phase names stay unique',
  ].join(', '),
  () => {
    // given
    const names = ['build', 'verify', 'build', 'verify']

    // when
    const actual = resolveSteps(names)

    // then
    expect(actual.map((step) => step.params.name)).toEqual([
      'build',
      'verify',
      'build_2',
      'verify_2',
    ])
  },
)

test(
  [
    'given use-cases/steps::resolveSteps',
    'when a name is not a step',
    'it should throw and list the names that are',
  ].join(', '),
  () => {
    // given
    const names = ['plan', 'deploy']

    // when, then
    expect(() => resolveSteps(names)).toThrow(
      /unknown step\(s\): deploy[\s\S]*code-review/,
    )
  },
)

test(
  [
    'given use-cases/steps::resolveSteps',
    'when the prompt step is pointed at another agent',
    'it should own its phase with that agent and say so in the description',
  ].join(', '),
  () => {
    // given
    const names = ['prompt']

    // when
    const actual = resolveSteps(names, { agent: 'scout' })

    // then
    expect(actual[0]?.params.owner).toEqual('scout')
    expect(actual[0]?.params.description).toContain('scout')
  },
)

test(
  [
    'given use-cases/steps::requiredAgents',
    'when a chain uses one agent twice and a code step',
    'it should name each agent once and the code step not at all',
  ].join(', '),
  () => {
    // given
    const steps = resolveSteps(['build', 'verify', 'build', 'review'])

    // when
    const actual = requiredAgents(steps)

    // then
    expect(actual).toEqual(['builder', 'reviewer'])
  },
)
