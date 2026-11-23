import { expect, test } from 'bun:test'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { activityOrder, activitySuccession } from '../../../../lib/contracts'
import {
  EMPTY_REPOSITORY_PATH,
  SHIPPED_CONFIG_DIR,
  shippedConfig,
  shippedEnv,
} from '../../../../testing/shipped-layer'
import { registryFaults } from '../../../activities'
import { promptFile, revisePromptPath } from '../../../agents'
import { loadLifecycles } from '../../../planning'
import { loadConfigWithNotes } from './load-config'

for (const [name, destination] of [
  ['crust.config.machine.example.toml', 'crust.config.toml'],
  ['crust.activities.machine.example.toml', 'crust.activities.toml'],
  ['crust.lifecycles.machine.example.toml', 'crust.lifecycles.toml'],
  ['crust.activities.bic.example.toml', 'crust.activities.toml'],
  ['crust.activities.econ.example.toml', 'crust.activities.toml'],
  ['pi-crust.example.toml', 'pi-crust.toml'],
]) {
  test(
    [
      `given @SC23 example ${name}`,
      'when copied to its documented destination over the package layer',
      'it should load and have valid lifecycle concurrency',
    ].join(', '),
    () => {
      // given
      const directory = mkdtempSync(join(tmpdir(), 'crust-toml-example-'))
      try {
        mkdirSync(directory, { recursive: true })
        const path = join(directory, destination)
        copyFileSync(
          join(import.meta.dir, '../../../../../cookbooks/examples', name),
          path,
        )
        const repository =
          destination === 'pi-crust.toml' ? path : EMPTY_REPOSITORY_PATH
        const env =
          destination === 'pi-crust.toml'
            ? shippedEnv()
            : { ...shippedEnv(), CRUST_MACHINE_CONFIG: directory }
        // when
        const actual = () =>
          loadLifecycles(loadConfigWithNotes(repository, env).config)
        // then
        expect(actual).not.toThrow()
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    },
  )
}

test(
  [
    'given @SC18 @SC21 shipped configuration',
    'when loaded through the real layer reader',
    'it should preserve history locations and discover the delivery remote and base',
  ].join(', '),
  () => {
    // given
    // when
    const actual = shippedConfig()
    // then
    expect(actual.defaults.data_dir).toBe('{primary_worktree}/.pi-crust/data')
    expect(actual.observability.db).toBe(
      '{primary_worktree}/.pi-crust/data/crust.db',
    )
    expect(actual.tasks).toEqual({})
    expect(actual.task_config.timeout_seconds).toBe(300)
    expect(actual.terminal[0]?.delivery).toEqual({ draft: false })
    expect(actual.defaults.protected_files).toContain('pi-crust.toml')
    expect(actual.defaults.protected).toEqual({ read: 'block', write: 'block' })
  },
)

test(
  [
    'given every shipped agent',
    'when validating the registry and prompt directories',
    'it should accept the published output names and find both required prompt files',
  ].join(', '),
  () => {
    // given
    const cfg = shippedConfig()
    // when
    const faults = registryFaults(cfg.activities)
    const missing = cfg.agents.flatMap((agent) =>
      (['system', 'user'] as const)
        .filter((kind) => !existsSync(promptFile(agent.prompts, kind)))
        .map((kind) => `${agent.name}: ${kind}`),
    )
    // then
    expect(faults).toEqual([])
    expect(missing).toEqual([])
    expect(cfg.activities).toHaveLength(21)
    expect(cfg.planners).toHaveLength(2)
    expect(cfg.terminal).toHaveLength(1)
  },
)

for (const [name, directory, revise] of [
  ['build', 'build', true],
  ['plan', 'plan', true],
  ['test', 'test', true],
  ['test-tdd', 'test', true],
  ['scout', 'scout', false],
] as const) {
  test(
    [
      `given @SC13 shipped ${name}`,
      'when resolving the revise prompt',
      'it should use its configured directory and fall back only when revise.md is absent',
    ].join(', '),
    () => {
      // given
      const activity = shippedConfig().activities.find(
        (one) => one.name === name,
      )
      if (activity === undefined) throw new Error(`missing ${name}`)
      // when
      const actual = revisePromptPath(activity.prompts)
      // then
      expect(activity.prompts).toBe(
        join(SHIPPED_CONFIG_DIR, '../prompts', directory),
      )
      expect(actual).toBe(
        join(activity.prompts, revise ? 'revise.md' : 'user.md'),
      )
      expect(existsSync(actual)).toBe(true)
    },
  )
}

test(
  [
    'given the shipped Activity registry',
    'when succession is resolved',
    'it should preserve explicit and output-derived succession and omit it on engine entries',
  ].join(', '),
  () => {
    // given
    const cfg = shippedConfig()
    // when
    const actual = cfg.activities.map((entry) =>
      activitySuccession(cfg.activities, entry.name),
    )
    // then
    expect(actual).toEqual(
      cfg.activities.map((entry) =>
        entry.output === 'reviewOutput' || entry.name === 'gh-issue'
          ? 'annotates'
          : 'supersedes',
      ),
    )
    expect(
      [...cfg.planners, ...cfg.terminal].some((entry) => 'succession' in entry),
    ).toBe(false)
  },
)

for (const name of ['ship', 'bugfix', 'ship-to-outcome']) {
  test(
    [
      `given shipped lifecycle ${name}`,
      'when the plan stage completes',
      'it should review comprehension and readiness concurrently before building',
    ].join(', '),
    () => {
      // given
      const cfg = shippedConfig()
      // when
      const lifecycle = loadLifecycles(cfg).find((entry) => entry.name === name)
      const stages = lifecycle?.stages ?? []
      const at = stages.findIndex((stage) => stage.activities.includes('plan'))
      // then
      expect(at).toBeGreaterThanOrEqual(0)
      expect(stages[at]?.activities.at(-1)).toBe('plan')
      expect(stages[at + 1]).toEqual({
        name: 'review-plan',
        strategy: 'concurrent',
        activities: ['plan-comprehension', 'plan-readiness'],
      })
    },
  )
}

test(
  [
    'given the shipped lifecycle and reviewer configuration',
    'when validated against Activity writes',
    'it should accept all concurrency claims and retain the shipped progression and grants',
  ].join(', '),
  () => {
    // given
    const cfg = shippedConfig()
    // when
    const lifecycles = loadLifecycles(cfg)
    const ship = lifecycles.find((entry) => entry.name === 'ship')
    const comprehension = cfg.activities.find(
      (entry) => entry.name === 'plan-comprehension',
    )
    const readiness = cfg.activities.find(
      (entry) => entry.name === 'plan-readiness',
    )
    // then
    expect(lifecycles.length).toBeGreaterThan(0)
    expect(ship?.stages.map((stage) => stage.name)).toEqual([
      'discover',
      'review-plan',
      'deliver',
      'accept',
      'push',
    ])
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
    expect(comprehension?.tools).toEqual(['read', 'write'])
    expect(readiness?.tools).toEqual(['bash', 'read', 'write'])
    expect(comprehension?.writes).toEqual(['{handoff}/plan_comprehension.md'])
    expect(readiness?.writes).toEqual(['{handoff}/plan_readiness.md'])
    expect(
      cfg.activities.find((entry) => entry.name === 'plan')?.attempts,
    ).toBe(3)
    expect(cfg.activities.some((entry) => entry.name === 'plan-review')).toBe(
      false,
    )
  },
)
