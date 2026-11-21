import { expect, test } from 'bun:test'
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TPiCrustConfig } from '../../../../lib/contracts'
import {
  activitiesFileSchema,
  activityOrder,
  crustConfigSchema,
  lifecyclesFileSchema,
} from '../../../../lib/contracts'
import { isFile } from '../../../../lib/system'
import { registryFaults } from '../../../activities'
import { resolvePromptPath, revisePromptReference } from '../../../agents'
import { loadLifecycles } from '../../../planning'

/*
 * The templates a team is actually given, not a fixture shaped like them.
 *
 * A concurrency claim that only ever passes against a hand-written stage is
 * a check nobody has pointed at the thing it exists to protect. These read
 * the shipped files, so the day somebody groups two writers under
 * `concurrent` the suite says so rather than the run doing.
 */
const STAMP = join(import.meta.dir, '../../../../../templates/stamp/config')
/** Examples live in cookbooks/ (issue #24, 1.10.1) — documentation, not a stamp. */
const EXAMPLES = join(import.meta.dir, '../../../../../cookbooks/examples')

for (const name of [
  'crust.activities.yaml',
  'crust.activities-bic.example.yaml',
  'crust.activities-econ.example.yaml',
]) {
  test(
    [
      `given the shipped ${name} template`,
      'when parsing its pull request delivery configuration',
      'it should leave the base absent so the remote default can win',
    ].join(', '),
    () => {
      // given
      const yaml = readFileSync(join(STAMP, name), 'utf8')
      // when
      const actual = activitiesFileSchema
        .parse(Bun.YAML.parse(yaml))
        .terminal.find((one) => one.name === 'gh-pull-request')
      // then
      expect(actual).toBeDefined()
      expect(actual?.delivery.base).toBeUndefined()
    },
  )
}

const lifecyclesAt = (yaml: string): string => {
  const path = join(
    mkdtempSync(join(tmpdir(), 'crust-shipped-')),
    'crust.lifecycles.yaml',
  )
  writeFileSync(path, yaml)

  return path
}

/**
 * The Lifecycle names a file declares, read from the file.
 *
 * Spelled out as a literal, this assertion rotted the day four Lifecycles
 * were added: the suite went red over a list, which says nothing about
 * whether the claims those Lifecycles make are sound. What is being checked
 * is that `loadLifecycles` ACCEPTS the shipped file and keeps its order, so
 * the expectation is derived from the file rather than transcribed from it.
 */
const declaredIn = (path: string): readonly string[] =>
  lifecyclesFileSchema
    .parse(Bun.YAML.parse(readFileSync(path, 'utf8')))
    .lifecycles.map((one) => one.name)

const shippedConfig = (): TPiCrustConfig => {
  const registry = activitiesFileSchema.parse(
    Bun.YAML.parse(readFileSync(join(STAMP, 'crust.activities.yaml'), 'utf8')),
  )

  return crustConfigSchema.parse({
    activities: registry.activities,
    planners: registry.planners,
    terminal: registry.terminal,
    agents: [
      ...registry.activities,
      ...registry.planners,
      ...registry.terminal,
    ],
  })
}

for (const [name, directory] of [
  ['build', 'build'],
  ['test', 'test'],
  ['test-tdd', 'test'],
  ['plan', 'plan'],
]) {
  test(
    [
      `given the shipped ${name} Activity`,
      'when resolving its revise prompt without a configuration key',
      'it should select the shipped revise file beside user',
    ].join(', '),
    () => {
      // given
      const activity = shippedConfig().activities.find(
        (one) => one.name === name,
      )
      if (activity === undefined)
        throw new Error(`missing shipped Activity ${name}`)

      // when
      const reference = revisePromptReference(activity.prompts)

      // then
      expect(activity.prompts.revise).toBeUndefined()
      expect(reference).toBe(`prompts/${directory}/revise.md`)
      expect(isFile(resolvePromptPath(reference))).toBe(true)
    },
  )
}

test(
  [
    'given use-cases/load-lifecycles::loadLifecycles',
    'when the shipped lifecycles are loaded against the shipped roster',
    'it should accept every concurrency claim they make',
  ].join(', '),
  () => {
    // given
    const given = join(STAMP, 'crust.lifecycles.yaml')

    // when
    const actual = loadLifecycles(given, shippedConfig())

    // then
    expect(actual.map((one) => one.name)).toEqual([...declaredIn(given)])
    expect(actual.length).toBeGreaterThan(0)
  },
)

test(
  [
    'given use-cases/load-lifecycles::loadLifecycles',
    'when a stage claims concurrency for two activities that both write code',
    'it should refuse, which is what proves the shipped file passing means anything',
  ].join(', '),
  () => {
    // given
    const given = lifecyclesAt(`
lifecycles:
  - name: racy
    stages:
      - name: implement
        strategy: concurrent
        activities: [test, build]
`)

    // when
    const actual = () => loadLifecycles(given, shippedConfig())

    // then
    expect(actual).toThrow(/concurrently, but both may write/)
  },
)

test(
  [
    'given use-cases/load-lifecycles::loadLifecycles',
    'when that same pair is serial instead',
    'it should load, because serially there is nothing to race',
  ].join(', '),
  () => {
    // given
    const given = lifecyclesAt(`
lifecycles:
  - name: fine
    stages:
      - name: implement
        activities: [test, build]
`)

    // when
    const actual = loadLifecycles(given, shippedConfig())

    // then
    expect(actual).toHaveLength(1)
  },
)

test(
  [
    'given use-cases/load-lifecycles::loadLifecycles',
    'when the shipped local example is laid over the shipped lifecycles',
    'it should load, because an example nobody runs is an example that drifts',
  ].join(', '),
  () => {
    // given
    const dir = mkdtempSync(join(tmpdir(), 'crust-example-'))
    const base = join(dir, 'crust.lifecycles.yaml')
    copyFileSync(join(STAMP, 'crust.lifecycles.yaml'), base)
    copyFileSync(
      join(EXAMPLES, 'crust.lifecycles.local.example.yaml'),
      join(dir, 'crust.lifecycles.local.yaml'),
    )

    // when
    const actual = loadLifecycles(base, shippedConfig())

    // then — the team's file holds its order, and the example's additions
    // follow it rather than splicing into the middle
    expect(actual.map((one) => one.name)).toEqual([
      ...declaredIn(base),
      ...declaredIn(join(dir, 'crust.lifecycles.local.yaml')).filter(
        (name) => !declaredIn(base).includes(name),
      ),
    ])
  },
)

test(
  [
    'given use-cases/load-lifecycles::loadLifecycles',
    'when the local example claims two researchers may run concurrently',
    'it should hold, because their declared documents do not overlap',
  ].join(', '),
  () => {
    // given
    const dir = mkdtempSync(join(tmpdir(), 'crust-example-'))
    const base = join(dir, 'crust.lifecycles.yaml')
    writeFileSync(base, 'lifecycles: []')
    copyFileSync(
      join(EXAMPLES, 'crust.lifecycles.local.example.yaml'),
      join(dir, 'crust.lifecycles.local.yaml'),
    )

    // when
    const actual = loadLifecycles(base, shippedConfig())
    const survey = actual.find((one) => one.name === 'survey')

    // then
    expect(
      survey?.stages.find((one) => one.name === 'research')?.strategy,
    ).toBe('concurrent')
  },
)

test(
  [
    'given use-cases/load-lifecycles::loadLifecycles',
    'when the shipped lifecycles are read',
    'it should cut stages by progression, not one stage per activity',
  ].join(', '),
  () => {
    // given
    const given = join(STAMP, 'crust.lifecycles.yaml')

    // when
    const actual = loadLifecycles(given, shippedConfig())
    const stagesOf = (name: string) =>
      actual.find((one) => one.name === name)?.stages.map((s) => s.name)

    // then
    expect(stagesOf('ship')).toEqual([
      'discover',
      'review-plan',
      'deliver',
      'accept',
      'push',
    ])
    expect(stagesOf('bugfix')).toEqual([
      'diagnose',
      'review-plan',
      'deliver',
      'accept',
      'push',
    ])
    expect(stagesOf('de-risk')).toEqual(['discover', 'prove'])
  },
)

test(
  [
    'given use-cases/load-lifecycles::loadLifecycles',
    'when ship is flattened',
    'it should run these activities',
  ].join(', '),
  () => {
    // given
    const given = join(STAMP, 'crust.lifecycles.yaml')

    // when
    const actual = loadLifecycles(given, shippedConfig())
    const ship = actual.find((one) => one.name === 'ship')

    // then
    expect(
      activityOrder(ship ?? { name: '', description: '', stages: [] }),
    ).toEqual([
      'identify',
      'plan',
      'plan-comprehension',
      'plan-readiness',
      'build',
      'outcome-review',
      'code-review',
      'gh-pull-request',
    ])
  },
)

test(
  [
    'given use-cases/load-lifecycles::loadLifecycles',
    'when a shipped stage is serial',
    'it should be allowed to hold a sequence',
  ].join(', '),
  () => {
    // given
    const given = join(STAMP, 'crust.lifecycles.yaml')

    // when
    const actual = loadLifecycles(given, shippedConfig())
    const ship = actual.find((one) => one.name === 'ship')
    const discover = ship?.stages.find((one) => one.name === 'discover')

    // then
    expect(discover?.strategy).toBe('serial')
    expect(discover?.activities).toEqual(['identify', 'plan'])
  },
)

for (const name of ['ship', 'bugfix', 'ship-to-outcome']) {
  test(
    [
      'given the shipped lifecycle and Activity registries',
      `when ${name} reaches its completed plan`,
      'it should judge the plan concurrently before any following work',
    ].join(', '),
    () => {
      // given
      const cfg = shippedConfig()
      const path = join(STAMP, 'crust.lifecycles.yaml')

      // when
      const lifecycle = loadLifecycles(path, cfg).find(
        (one) => one.name === name,
      )
      const stages = lifecycle?.stages ?? []
      const at = stages.findIndex((one) => one.activities.includes('plan'))
      const review = stages[at + 1]

      // then
      expect(at).toBeGreaterThanOrEqual(0)
      expect(stages[at]?.activities.at(-1)).toBe('plan')
      expect(review).toEqual({
        name: 'review-plan',
        strategy: 'concurrent',
        activities: ['plan-comprehension', 'plan-readiness'],
      })
    },
  )
}

test(
  [
    'given the shipped plan reviewers',
    'when their tool and write grants are loaded',
    'it should isolate comprehension from the repository and keep their findings disjoint',
  ].join(', '),
  () => {
    // given
    const cfg = shippedConfig()

    // when
    const comprehension = cfg.activities.find(
      (one) => one.name === 'plan-comprehension',
    )
    const readiness = cfg.activities.find(
      (one) => one.name === 'plan-readiness',
    )

    // then
    expect(comprehension?.tools).toEqual(['read', 'write'])
    expect(readiness?.tools).toEqual(['bash', 'read', 'write'])
    expect(comprehension?.writes).toEqual(['{handoff}/plan_comprehension.md'])
    expect(readiness?.writes).toEqual(['{handoff}/plan_readiness.md'])
    expect([comprehension?.output, readiness?.output]).toEqual([
      'reviewOutput',
      'reviewOutput',
    ])
    expect(comprehension?.gates).toEqual([
      'artifactsExist',
      'verdictConsistent',
    ])
    expect(readiness?.gates).toEqual(['artifactsExist', 'verdictConsistent'])
    expect(cfg.activities.find((one) => one.name === 'plan')?.attempts).toBe(3)
    expect(cfg.activities.some((one) => one.name === 'plan-review')).toBe(false)
  },
)

test(
  [
    'given use-cases/activity-registry::registryFaults',
    "when the shipped activities are checked against this package's own catalogues",
    'it should name no fault, because output and gates are names this package actually publishes',
  ].join(', '),
  () => {
    // given
    const given = shippedConfig()

    // when
    const actual = registryFaults(given.activities)

    // then
    expect(actual).toEqual([])
  },
)

test(
  [
    'given use-cases/shipped-config::shippedConfig',
    'when every shipped Activity and Planner is checked',
    'it should resolve both of its prompt files to a real file',
  ].join(', '),
  () => {
    // given
    const given = shippedConfig()

    // when
    const actual = given.agents.flatMap((agent) =>
      [agent.prompts.system, agent.prompts.user]
        .filter((reference) => !isFile(resolvePromptPath(reference)))
        .map((reference) => `${agent.name}: ${reference}`),
    )

    // then
    expect(actual).toEqual([])
  },
)
