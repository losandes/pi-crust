import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { activitiesFileSchema, activityConfigSchema } from '../typedefs/activity'
import { ENVELOPE_NAMES } from '../typedefs/envelope'
import { GATE_NAMES } from './gates'
import { registryFaults, resolveActivities } from './activity-registry'

const STAMP = join(import.meta.dir, '../../../templates/stamp/config')

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
     * given — this refusal is what replaces the compiler's union of step
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
      Bun.YAML.parse(readFileSync(join(STAMP, 'crust.activities.yaml'), 'utf8')),
    ).activities

    // when
    const actual = resolveActivities(given)

    // then
    expect(actual).toHaveLength(given.length)
    expect(
      actual.every((one) => one.spec.name !== '' && one.gates.every((gate) => gate.name !== '')),
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
