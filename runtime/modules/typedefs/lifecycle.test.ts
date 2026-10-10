import { expect, test } from 'bun:test'
import {
  activityOrder,
  lifecycleConfigSchema,
  lifecycleFaults,
  lifecycleNamed,
  lifecyclesFileSchema,
  stageOrder,
} from './lifecycle'

const lifecycle = (yaml: string) =>
  lifecycleConfigSchema.parse(Bun.YAML.parse(yaml))

/** The three shipped lifecycles, as the files declared them. */
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
    'when the sdlc lifecycle is expressed as dependent stages',
    'it should flatten to the order the file it replaces declared',
  ].join(', '),
  () => {
    // given
    const given = lifecycle(`
name: sdlc
stages:
  - name: discover
    activities: [identify, conceptualize]
  - name: design
    activities: [plan, design]
    depends_on: [discover]
  - name: implement
    activities: [test, build]
    depends_on: [design]
  - name: accept
    activities: [verify, review, code-review]
    depends_on: [implement]
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
    'when the bugfix lifecycle is expressed as dependent stages',
    'it should flatten to the order the file it replaces declared',
  ].join(', '),
  () => {
    // given
    const given = lifecycle(`
name: bugfix
stages:
  - name: diagnose
    activities: [diagnose]
  - name: implement
    activities: [plan, test, build]
    depends_on: [diagnose]
  - name: accept
    activities: [verify, review, code-review]
    depends_on: [implement]
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
    'when the de-risk lifecycle is expressed as dependent stages',
    'it should flatten to the order the file it replaces declared',
  ].join(', '),
  () => {
    // given
    const given = lifecycle(`
name: de-risk
stages:
  - name: discover
    activities: [identify, conceptualize]
  - name: design
    activities: [plan, design]
    depends_on: [discover]
  - name: prove
    activities: [poc]
    depends_on: [design]
`)

    // when
    const actual = activityOrder(given)

    // then
    expect(actual).toEqual(DE_RISK)
  },
)

test(
  [
    'given typedefs/lifecycle::stageOrder',
    'when stages declare dependencies out of written order',
    'it should order by the dependencies rather than by position',
  ].join(', '),
  () => {
    // given — written last-first on purpose
    const given = lifecycle(`
name: inverted
stages:
  - name: third
    activities: [verify]
    depends_on: [second]
  - name: second
    activities: [build]
    depends_on: [first]
  - name: first
    activities: [plan]
`)

    // when
    const actual = stageOrder(given)

    // then
    expect(actual).toEqual(['first', 'second', 'third'])
  },
)

test(
  [
    'given typedefs/lifecycle::stageOrder',
    'when nothing depends on anything',
    'it should keep the written order so a trace stays comparable',
  ].join(', '),
  () => {
    // given
    const given = lifecycle(`
name: flat
stages:
  - name: a
    activities: [scout]
  - name: b
    activities: [plan]
  - name: c
    activities: [build]
`)

    // when
    const actual = stageOrder(given)

    // then
    expect(actual).toEqual(['a', 'b', 'c'])
  },
)

test(
  [
    'given typedefs/lifecycle::lifecycleFaults',
    'when two stages depend on each other',
    'it should report a cycle rather than ordering them arbitrarily',
  ].join(', '),
  () => {
    // given
    const given = lifecycle(`
name: looped
stages:
  - name: a
    activities: [plan]
    depends_on: [b]
  - name: b
    activities: [build]
    depends_on: [a]
`)

    // when
    const actual = lifecycleFaults(given)

    // then
    expect(actual).toHaveLength(1)
    expect(actual[0]?.message).toContain('cycle')
  },
)

test(
  [
    'given typedefs/lifecycle::lifecycleFaults',
    'when a stage depends on one the lifecycle does not declare',
    'it should name the missing stage rather than silently ignoring it',
  ].join(', '),
  () => {
    // given
    const given = lifecycle(`
name: dangling
stages:
  - name: a
    activities: [plan]
    depends_on: [nowhere]
`)

    // when
    const actual = lifecycleFaults(given)

    // then
    expect(actual[0]?.message).toContain('nowhere')
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
  - name: a
    activities: [plan]
  - name: b
    activities: [build]
    depends_on: [a]
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
    'when a lifecycle the file does not declare is asked for',
    'it should be absent rather than an empty lifecycle that runs nothing',
  ].join(', '),
  () => {
    // given
    const given = lifecyclesFileSchema.parse(
      Bun.YAML.parse(`
lifecycles:
  - name: sdlc
    stages: []
`),
    )

    // when
    const actual = lifecycleNamed(given.lifecycles, 'nope')

    // then
    expect(actual).toBeUndefined()
  },
)
