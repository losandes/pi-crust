import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  activitiesFileSchema,
  activityConfigSchema,
  ENVELOPE_NAMES,
} from '../../../../lib/contracts'
import { GATE_NAMES } from '../../../gates'
import {
  registryFaults,
  resolveActivities,
  resolvedNamed,
} from './activity-registry'

const STAMP = join(import.meta.dir, '../../../../../templates/stamp/config')

const activity = (over: Readonly<Record<string, unknown>>) =>
  activityConfigSchema.parse({
    name: 'spike',
    purpose: 'Answer one throwaway question',
    prompt_engineering: { system: 's.md', user: 'u.md' },
    ...over,
  })

test(
  [
    'given use-cases/activity-registry::resolveActivities',
    'when an Activity names an envelope nothing publishes',
    'it should refuse at load, naming what was available',
  ].join(', '),
  () => {
    /*
     * given — this refusal is what replaces the compiler's union of activity
     * names. It has to be as loud as the compiler was, or moving the
     * registry into configuration is a straight loss.
     */
    const given = [activity({ output: 'spikeOutput' })]

    // when
    const actual = () => resolveActivities(given)

    // then
    expect(actual).toThrow(/output 'spikeOutput' is not an envelope/)
    expect(actual).toThrow(/planOutput/)
  },
)

test(
  [
    'given use-cases/activity-registry::resolveActivities',
    'when an Activity names a gate nothing publishes',
    'it should refuse at load, naming what was available',
  ].join(', '),
  () => {
    // given
    const given = [activity({ output: 'planOutput', gates: ['looksRight'] })]

    // when
    const actual = () => resolveActivities(given)

    // then
    expect(actual).toThrow(/gate 'looksRight' is not a gate/)
    expect(actual).toThrow(/artifactsExist/)
  },
)

test(
  [
    'given use-cases/activity-registry::registryFaults',
    'when an entry claims a Planner name',
    'it should refuse, because a Lifecycle must not be able to name a Planner',
  ].join(', '),
  () => {
    // given
    const given = [activity({ name: 'operator', output: 'operatorPlanOutput' })]

    // when
    const actual = registryFaults(given)

    // then
    expect(actual[0]).toContain('that is a Planner, not an Activity')
  },
)

test(
  [
    'given use-cases/activity-registry::registryFaults',
    'when one name is registered twice',
    'it should refuse, because a Lifecycle naming it could not say which',
  ].join(', '),
  () => {
    // given
    const given = [
      activity({ name: 'plan', output: 'planOutput' }),
      activity({ name: 'plan', output: 'buildOutput' }),
    ]

    // when
    const actual = registryFaults(given)

    // then
    expect(actual[0]).toContain("activity 'plan' is registered twice")
  },
)

test(
  [
    'given use-cases/activity-registry::resolveActivities',
    'when the shipped registry is resolved',
    'it should resolve every output and gate it names, because a shipped name that does not resolve is a capability nobody can run',
  ].join(', '),
  () => {
    // given
    const given = activitiesFileSchema.parse(
      Bun.YAML.parse(
        readFileSync(join(STAMP, 'crust.activities.yaml'), 'utf8'),
      ),
    ).activities

    // when
    const actual = resolveActivities(given)

    // then
    expect(actual).toHaveLength(given.length)
    expect(
      actual.every(
        (one) =>
          one.spec.name !== '' && one.gates.every((gate) => gate.name !== ''),
      ),
    ).toBe(true)
  },
)

test(
  [
    'given use-cases/activity-registry::resolveActivities',
    'when every published envelope and gate is named by an Activity',
    'it should resolve all of them, so the catalogues are reachable by name',
  ].join(', '),
  () => {
    // given — one Activity per envelope, each naming every gate
    const given = ENVELOPE_NAMES.map((output, at) =>
      activity({ name: `activity-${at}`, output, gates: GATE_NAMES }),
    )

    // when
    const actual = resolveActivities(given)

    // then
    expect(actual.map((one) => one.spec.name)).toHaveLength(
      ENVELOPE_NAMES.length,
    )
    expect(actual[0]?.gates.map((gate) => gate.name)).toHaveLength(
      GATE_NAMES.length,
    )
  },
)

test(
  [
    'given use-cases/activity-registry::registryFaults',
    'when an alias is the name of another Activity',
    'it should refuse, naming both the entry and the Activity it collides with',
  ].join(', '),
  () => {
    // given
    const given = [
      activity({ name: 'gh-pull-request', aliases: ['build'] }),
      activity({ name: 'build' }),
    ]

    // when
    const actual = registryFaults(given)

    // then
    expect(actual).toContain(
      "activity 'gh-pull-request': alias 'build' is the name of activity " +
        "'build' — a chain naming it could not say which Activity it meant",
    )
  },
)

test(
  [
    'given use-cases/activity-registry::registryFaults',
    'when an alias is a Planner name',
    'it should refuse, naming both the entry and the Planner it collides with',
  ].join(', '),
  () => {
    // given
    const given = [activity({ name: 'gh-pull-request', aliases: ['triage'] })]

    // when
    const actual = registryFaults(given)

    // then
    expect(actual).toContain(
      "activity 'gh-pull-request': alias 'triage' is a Planner — the " +
        'Planners are operator, triage and configuration cannot make one ' +
        'nameable in a chain',
    )
  },
)

test(
  [
    'given use-cases/activity-registry::registryFaults',
    'when an alias was already declared by an earlier entry',
    'it should refuse, naming both the entry and the Activity that already has it',
  ].join(', '),
  () => {
    // given
    const given = [
      activity({ name: 'publish', aliases: ['pr'] }),
      activity({ name: 'gh-pull-request', aliases: ['pr'] }),
    ]

    // when
    const actual = registryFaults(given)

    // then
    expect(actual).toContain(
      "activity 'gh-pull-request': alias 'pr' is already an alias of " +
        "activity 'publish' — one name cannot resolve to two Activities",
    )
  },
)

test(
  [
    'given use-cases/activity-registry::registryFaults',
    'when a registry declares aliases that collide with nothing',
    'it should resolve, because a rule that refuses everything passes every refusal test on its own',
  ].join(', '),
  () => {
    // given
    const given = [
      activity({ name: 'publish', aliases: ['pub'] }),
      activity({ name: 'build' }),
    ]

    // when
    const actual = () => resolveActivities(given)

    // then
    expect(actual).not.toThrow()
  },
)

test(
  [
    'given use-cases/activity-registry::registryFaults',
    "when an alias is equal to its own entry's name",
    'it should refuse, because it is harmless to run and pointless to write',
  ].join(', '),
  () => {
    // given
    const given = [activity({ name: 'build', aliases: ['build'] })]

    // when
    const actual = registryFaults(given)

    // then
    expect(actual).toContain(
      "activity 'build': alias 'build' is the name of activity 'build' — a " +
        'chain naming it could not say which Activity it meant',
    )
  },
)

test(
  [
    'given use-cases/activity-registry::registryFaults',
    'when one entry declares the same alias twice',
    'it should refuse, naming the entry and the repeated alias',
  ].join(', '),
  () => {
    // given
    const given = [activity({ name: 'gh-pull-request', aliases: ['pr', 'pr'] })]

    // when
    const actual = registryFaults(given)

    // then
    expect(actual).toContain(
      "activity 'gh-pull-request': declares alias 'pr' twice",
    )
  },
)

test(
  [
    'given use-cases/activity-registry::registryFaults',
    'when an entry claims an input this package does not publish',
    'it should refuse, naming what is available',
  ].join(', '),
  () => {
    // given
    const given = [activity({ output: 'planOutput', input: 'bogus' })]

    // when
    const actual = registryFaults(given)

    // then
    expect(actual[0]).toContain("input 'bogus' is not an input")
  },
)

test(
  [
    'given use-cases/activity-registry::registryFaults',
    'when an entry claims a terminal Activity name',
    'it should refuse, because a Lifecycle must not name one mid-chain',
  ].join(', '),
  () => {
    // given
    const given = [activity({ name: 'gh-pull-request', output: 'planOutput' })]

    // when
    const actual = registryFaults(given)

    // then
    expect(actual[0]).toContain('that is a terminal Activity, not an Activity')
  },
)

test(
  [
    'given use-cases/activity-registry::resolvedNamed',
    'when the name is registered',
    'it should find the resolved activity by name',
  ].join(', '),
  () => {
    // given
    const given = [activity({ output: 'planOutput' })]
    const resolved = resolveActivities(given)

    // when
    const actual = resolvedNamed(resolved, 'spike')

    // then
    expect(actual?.config.name).toEqual('spike')
  },
)

test(
  [
    'given use-cases/activity-registry::resolvedNamed',
    'when the name is not registered',
    'it should be undefined',
  ].join(', '),
  () => {
    // given
    const given = [activity({ output: 'planOutput' })]
    const resolved = resolveActivities(given)

    // when
    const actual = resolvedNamed(resolved, 'nonexistent')

    // then
    expect(actual).toBeUndefined()
  },
)
