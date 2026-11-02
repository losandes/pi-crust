import { expect, test } from 'bun:test'
import {
  activityOrder,
  lifecycleConfigSchema,
  lifecycleFaults,
  lifecycleNamed,
  lifecyclesFileSchema,
  stageOf,
  stagePlan,
  terminalIn,
  withoutTerminal,
} from './lifecycle'

const lifecycle = (yaml: string) =>
  lifecycleConfigSchema.parse(Bun.YAML.parse(yaml))

/** The three shipped lifecycles, as the files declare them. */
const SDLC = [
  'identify',
  'conceptualize',
  'plan',
  'design',
  'test',
  'build',
  'verify',
  'review',
  'code-review',
]
const BUGFIX = [
  'diagnose',
  'plan',
  'test',
  'build',
  'verify',
  'review',
  'code-review',
]
const DE_RISK = ['identify', 'conceptualize', 'plan', 'design', 'poc']

test(
  [
    'given typedefs/lifecycle::activityOrder',
    'when the sdlc lifecycle is expressed as stages',
    'it should flatten to the order the file it replaces declared',
  ].join(', '),
  () => {
    // given
    const given = lifecycle(`
name: sdlc
stages:
  - name: discover
    activities: [identify]
  - name: conceive
    activities: [conceptualize]
  - name: plan
    activities: [plan]
  - name: design
    activities: [design]
  - name: test
    activities: [test]
  - name: build
    activities: [build]
  - name: verify
    activities: [verify]
  - name: accept
    strategy: concurrent
    activities: [review, code-review]
`)

    // when
    const actual = activityOrder(given)

    // then
    expect(actual).toEqual(SDLC)
  },
)

test(
  [
    'given typedefs/lifecycle::activityOrder',
    'when the bugfix lifecycle is expressed as stages',
    'it should flatten to the order the file it replaces declared',
  ].join(', '),
  () => {
    // given
    const given = lifecycle(`
name: bugfix
stages:
  - name: diagnose
    activities: [diagnose]
  - name: plan
    activities: [plan]
  - name: test
    activities: [test]
  - name: build
    activities: [build]
  - name: verify
    activities: [verify]
  - name: accept
    strategy: concurrent
    activities: [review, code-review]
`)

    // when
    const actual = activityOrder(given)

    // then
    expect(actual).toEqual(BUGFIX)
  },
)

test(
  [
    'given typedefs/lifecycle::activityOrder',
    'when the de-risk lifecycle is expressed as stages',
    'it should flatten to the order the file it replaces declared',
  ].join(', '),
  () => {
    // given
    const given = lifecycle(`
name: de-risk
stages:
  - name: discover
    activities: [identify]
  - name: conceive
    activities: [conceptualize]
  - name: plan
    activities: [plan]
  - name: design
    activities: [design]
  - name: prove
    activities: [poc]
`)

    // when
    const actual = activityOrder(given)

    // then
    expect(actual).toEqual(DE_RISK)
  },
)

test(
  [
    'given typedefs/lifecycle::stageSchema',
    'when a stage does not say how its activities run',
    'it should be serial, so a file written before strategy existed is unchanged',
  ].join(', '),
  () => {
    // given
    const given = `
name: anything
stages:
  - name: implement
    activities: [test, build]
`

    // when
    const actual = lifecycle(given)

    // then
    expect(actual.stages[0]?.strategy).toBe('serial')
  },
)

test(
  [
    'given typedefs/lifecycle::stageSchema',
    'when a stage claims a strategy that does not exist',
    'it should refuse, rather than fall back to serial behind a typo',
  ].join(', '),
  () => {
    // given
    const given = `
name: anything
stages:
  - name: accept
    strategy: parallel
    activities: [review, code-review]
`

    // when
    const actual = () => lifecycle(given)

    // then
    expect(actual).toThrow()
  },
)

test(
  [
    'given typedefs/lifecycle::stagePlan',
    'when stages are declared',
    'it should keep them in declaration order, with their strategies',
  ].join(', '),
  () => {
    // given
    const given = lifecycle(`
name: anything
stages:
  - name: first
    activities: [a]
  - name: second
    strategy: concurrent
    activities: [b, c]
`)

    // when
    const actual = stagePlan(given)

    // then
    expect(actual.map((stage) => [stage.name, stage.strategy])).toEqual([
      ['first', 'serial'],
      ['second', 'concurrent'],
    ])
  },
)

test(
  [
    'given typedefs/lifecycle::stageOf',
    'when an activity belongs to a stage',
    'it should return that stage, so a gate can be lifted to it',
  ].join(', '),
  () => {
    // given
    const given = lifecycle(`
name: anything
stages:
  - name: build
    activities: [build]
  - name: accept
    strategy: concurrent
    activities: [review, code-review]
`)

    // when
    const actual = stageOf(given, 'code-review')

    // then
    expect(actual?.name).toBe('accept')
  },
)

test(
  [
    'given typedefs/lifecycle::stageOf',
    'when the lifecycle does not run that activity',
    'it should return nothing',
  ].join(', '),
  () => {
    // given
    const given = lifecycle(`
name: anything
stages:
  - name: build
    activities: [build]
`)

    // when
    const actual = stageOf(given, 'poc')

    // then
    expect(actual).toBeUndefined()
  },
)

test(
  [
    'given typedefs/lifecycle::lifecycleFaults',
    'when two stages share a name',
    'it should refuse, because a gate naming that stage would be ambiguous',
  ].join(', '),
  () => {
    // given
    const given = lifecycle(`
name: twice
stages:
  - name: implement
    activities: [build]
  - name: implement
    activities: [verify]
`)

    // when
    const actual = lifecycleFaults(given)

    // then
    expect(actual).toHaveLength(1)
    expect(actual[0]?.message).toContain("two stages are named 'implement'")
  },
)

test(
  [
    'given typedefs/lifecycle::lifecycleFaults',
    'when one stage names the same activity twice',
    'it should refuse, because concurrently that is an activity racing itself',
  ].join(', '),
  () => {
    // given
    const given = lifecycle(`
name: doubled
stages:
  - name: accept
    strategy: concurrent
    activities: [review, review]
`)

    // when
    const actual = lifecycleFaults(given)

    // then
    expect(actual).toHaveLength(1)
    expect(actual[0]?.message).toContain("names activity 'review' twice")
  },
)

test(
  [
    'given typedefs/lifecycle::lifecycleFaults',
    'when a lifecycle is well formed',
    'it should report nothing',
  ].join(', '),
  () => {
    // given
    const given = lifecycle(`
name: fine
stages:
  - name: build
    activities: [build]
  - name: accept
    strategy: concurrent
    activities: [review, code-review]
`)

    // when
    const actual = lifecycleFaults(given)

    // then
    expect(actual).toEqual([])
  },
)

test(
  [
    'given typedefs/lifecycle::lifecycleNamed',
    'when the file declares that lifecycle',
    'it should return it',
  ].join(', '),
  () => {
    // given
    const given = lifecyclesFileSchema.parse(
      Bun.YAML.parse(`
lifecycles:
  - name: sdlc
    stages:
      - name: build
        activities: [build]
  - name: bugfix
    stages:
      - name: diagnose
        activities: [diagnose]
`),
    ).lifecycles

    // when
    const actual = lifecycleNamed(given, 'bugfix')

    // then
    expect(actual?.stages[0]?.activities).toEqual(['diagnose'])
  },
)

test(
  [
    'given typedefs/lifecycle::lifecycleNamed',
    'when the file does not declare it',
    'it should return nothing',
  ].join(', '),
  () => {
    // given
    const given = lifecyclesFileSchema.parse(
      Bun.YAML.parse('lifecycles: []'),
    ).lifecycles

    // when
    const actual = lifecycleNamed(given, 'sdlc')

    // then
    expect(actual).toBeUndefined()
  },
)

test(
  [
    'given typedefs/lifecycle::lifecycleFaults',
    'when a terminal Activity is the last entry of the last stage',
    'it should accept the lifecycle',
  ].join(', '),
  () => {
    // given
    const given = lifecycle(`
name: ship
stages:
  - name: deliver
    activities: [build]
  - name: open
    activities: [code-review, gh-pull-request]
`)

    // when
    const actual = lifecycleFaults(given)

    // then
    expect(actual).toEqual([])
  },
)

test(
  [
    'given typedefs/lifecycle::lifecycleFaults',
    'when a terminal Activity is named mid-chain',
    'it should refuse, naming the Activity and where it must go',
  ].join(', '),
  () => {
    // given
    const given = lifecycle(`
name: ship
stages:
  - name: open
    activities: [gh-pull-request, build]
`)

    // when
    const actual = lifecycleFaults(given)

    // then
    expect(actual.map((one) => one.message).join('\n')).toMatch(
      /'gh-pull-request' is a terminal Activity.*last entry of the last stage/,
    )
  },
)

test(
  [
    'given typedefs/lifecycle::lifecycleFaults',
    'when a terminal Activity is the last entry of a concurrent stage',
    'it should refuse, because it does not run alongside anything',
  ].join(', '),
  () => {
    // given
    const given = lifecycle(`
name: ship
stages:
  - name: open
    strategy: concurrent
    activities: [code-review, gh-pull-request]
`)

    // when
    const actual = lifecycleFaults(given)

    // then
    expect(actual.map((one) => one.message).join('\n')).toMatch(
      /cannot run in a concurrent stage/,
    )
  },
)

test(
  [
    'given typedefs/lifecycle::terminalIn',
    'when a lifecycle names a terminal Activity',
    'it should find it, wherever it sits in the stages',
  ].join(', '),
  () => {
    // given
    const given = lifecycle(`
name: ship
stages:
  - name: accept
    activities: [review]
  - name: deliver
    activities: [gh-pull-request]
`)

    // when
    const actual = terminalIn(given.stages)

    // then
    expect(actual).toEqual('gh-pull-request')
  },
)

test(
  [
    'given typedefs/lifecycle::terminalIn',
    'when a lifecycle names no terminal Activity at all',
    'it should answer undefined, rather than guess at one',
  ].join(', '),
  () => {
    // given
    const given = lifecycle(`
name: ship
stages:
  - name: accept
    activities: [review]
`)

    // when
    const actual = terminalIn(given.stages)

    // then
    expect(actual).toBeUndefined()
  },
)

test(
  [
    'given typedefs/lifecycle::withoutTerminal',
    'when a stage holds only the terminal Activity',
    'it should drop the whole stage, rather than leave it empty',
  ].join(', '),
  () => {
    // given
    const given = lifecycle(`
name: ship
stages:
  - name: accept
    activities: [review]
  - name: deliver
    activities: [gh-pull-request]
`)

    // when
    const actual = withoutTerminal(given.stages)

    // then
    expect(actual.map((stage) => stage.name)).toEqual(['accept'])
  },
)

test(
  [
    'given typedefs/lifecycle::withoutTerminal',
    'when the terminal Activity shares a stage with something else',
    'it should drop only the terminal name, keeping the rest of the stage',
  ].join(', '),
  () => {
    // given
    const given = lifecycle(`
name: ship
stages:
  - name: accept
    strategy: concurrent
    activities: [code-review, gh-pull-request]
`)

    // when
    const actual = withoutTerminal(given.stages)

    // then
    expect(actual).toHaveLength(1)
    expect(actual[0]?.activities).toEqual(['code-review'])
  },
)
