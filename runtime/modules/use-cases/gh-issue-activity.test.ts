import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { activitiesFileSchema, DEFAULT_ATTEMPTS } from '../typedefs/activity'
import { crustConfigSchema } from '../typedefs/config'
import type { TPiCrustConfig } from '../typedefs/config'
import { lifecyclesFileSchema } from '../typedefs/lifecycle'
import { offeredActivities, runnableActivities } from './activities/index'
import { resolveActivities, resolvedNamed } from './activity-registry'
import { loadLifecycles } from './load-lifecycles'

/**
 * github.com/losandes/pi-crust/issues/25 — a discovery chain can end by
 * opening one GitHub issue.
 *
 * These read the SHIPPED `crust.activities.yaml` and `crust.lifecycles.yaml`
 * rather than a fixture shaped like them, because the issue's own success
 * criteria are about what a stamp installs: an Activity an operator can name
 * in `--activities` or a Planner can choose, and a Lifecycle that chains
 * `identify, plan, gh-issue`. `shipped-config.test.ts` already proves the
 * roster loads with no registry fault and every prompt file resolves; this
 * file proves the SHAPE of the `gh-issue` entry and its Lifecycle match what
 * the issue asked for, which a registry-fault check does not look at.
 */
const STAMP = join(import.meta.dir, '..', '..', '..', 'templates', 'stamp', 'config')

const shippedConfig = (): TPiCrustConfig => {
  const registry = activitiesFileSchema.parse(
    Bun.YAML.parse(readFileSync(join(STAMP, 'crust.activities.yaml'), 'utf8')),
  )

  return crustConfigSchema.parse({
    activities: registry.activities,
    planners: registry.planners,
    agents: [...registry.activities, ...registry.planners],
  })
}

test(
  [
    'given use-cases/activities::offeredActivities',
    'when the shipped roster is loaded',
    'it should offer gh-issue, so an operator can name it in --activities',
  ].join(', '),
  () => {
    // given
    const given = shippedConfig()

    // when
    const actual = offeredActivities(given)

    // then
    expect(actual).toContain('gh-issue')
  },
)

test(
  [
    'given use-cases/activities::runnableActivities',
    'when a chain names gh-issue by itself',
    'it should resolve it, proving --activities accepts the name',
  ].join(', '),
  () => {
    // given
    const given = shippedConfig()

    // when
    const actual = runnableActivities(['gh-issue'], given)

    // then
    expect(actual).toHaveLength(1)
  },
)

test(
  [
    'given use-cases/activity-registry::resolveActivities',
    'when the shipped gh-issue entry is resolved',
    'it should be reachable through bash, matching how gh is spawned',
  ].join(', '),
  () => {
    // given
    const given = resolveActivities(shippedConfig().activities)

    // when
    const actual = resolvedNamed(given, 'gh-issue')

    // then
    expect(actual?.config.tools).toContain('bash')
  },
)

test(
  [
    'given typedefs/activity::activityConfigSchema',
    'when the shipped gh-issue entry is parsed',
    'it should declare gates: [artifactsExist, filesNonEmpty, issueCreated]',
  ].join(', '),
  () => {
    // given
    const given = shippedConfig().activities.find((one) => one.name === 'gh-issue')

    // when
    const actual = given?.gates

    // then
    expect(actual).toEqual(['artifactsExist', 'filesNonEmpty', 'issueCreated'])
  },
)

test(
  [
    'given typedefs/activity::activityConfigSchema',
    'when the shipped gh-issue entry is parsed',
    'it should answer with ghIssueOutput, not documentOutput',
  ].join(', '),
  () => {
    // given
    const given = shippedConfig().activities.find((one) => one.name === 'gh-issue')

    // then
    expect(given?.output).toBe('ghIssueOutput')
  },
)

test(
  [
    'given typedefs/activity::activityConfigSchema',
    'when the shipped gh-issue entry is parsed',
    'it should write only its own handoff document, so {{output_document}} resolves',
  ].join(', '),
  () => {
    // given
    const given = shippedConfig().activities.find((one) => one.name === 'gh-issue')

    // then
    expect(given?.writes).toEqual(['{handoff}/gh_issue.md'])
  },
)

test(
  [
    'given typedefs/activity::activityConfigSchema',
    'when the shipped gh-issue entry is parsed',
    'it should not commit, because its effect is external, not a repository change',
  ].join(', '),
  () => {
    // given
    const given = shippedConfig().activities.find((one) => one.name === 'gh-issue')

    // then
    expect(given?.commit).toBe(false)
    expect(given?.attempts).toBe(DEFAULT_ATTEMPTS)
  },
)

test(
  [
    'given use-cases/load-lifecycles::loadLifecycles',
    'when the shipped lifecycles are read',
    'it should run a serial discover stage of identify, plan, gh-issue',
  ].join(', '),
  () => {
    // given
    const given = join(STAMP, 'crust.lifecycles.yaml')
    const file = lifecyclesFileSchema.parse(
      Bun.YAML.parse(readFileSync(given, 'utf8')),
    )
    const named = file.lifecycles.find((one) =>
      one.stages.some((stage) => stage.activities.includes('gh-issue')),
    )

    // when
    const actual = loadLifecycles(given, shippedConfig()).find(
      (one) => one.name === named?.name,
    )

    // then
    expect(actual?.stages).toHaveLength(1)
    expect(actual?.stages[0]?.strategy).toBe('serial')
    expect(actual?.stages[0]?.activities).toEqual(['identify', 'plan', 'gh-issue'])
  },
)

test(
  [
    'given use-cases/load-lifecycles::loadLifecycles',
    'when the shipped lifecycles are read',
    'it should change no existing Lifecycle\u2019s activities',
  ].join(', '),
  () => {
    // given
    const given = join(STAMP, 'crust.lifecycles.yaml')
    const actual = loadLifecycles(given, shippedConfig())
    const stagesOf = (name: string) =>
      actual.find((one) => one.name === name)?.stages.map((s) => s.activities)

    // then — unchanged from before this Activity existed
    expect(stagesOf('bugfix')).toEqual([
      ['diagnose'],
      ['plan', 'test-tdd', 'build'],
      ['outcome-review', 'code-review'],
      ['gh-pull-request'],
    ])
    expect(stagesOf('de-risk')).toEqual([
      ['identify'],
      ['plan', 'build'],
    ])
  },
)
