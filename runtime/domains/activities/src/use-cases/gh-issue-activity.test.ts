import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TPiCrustConfig } from '../../../../lib/contracts'
import {
  activitiesFileSchema,
  crustConfigSchema,
  DEFAULT_ATTEMPTS,
  lifecyclesFileSchema,
} from '../../../../lib/contracts'
import { render } from '../../../agents'
import { loadLifecycles } from '../../../planning'
import { resolveActivities, resolvedNamed } from './activity-registry'
import { listAnnotatingHandoffs } from './list-annotating-handoffs'
import { offeredActivities, runnableActivities } from './resolve-activities'

/**
 * github.com/losandes/pi-crust/issues/25 — a discovery chain can end by
 * opening one GitHub issue.
 *
 * These read the SHIPPED `crust.activities.yaml` and `crust.lifecycles.yaml`
 * rather than a fixture shaped like them, because the issue's own success
 * criteria are about what a stamp installs: an Activity an operator can name
 * in `--activities` or a Planner can choose, and a Lifecycle that chains
 * `identify, plan`, plan review, then `gh-issue`. `shipped-config.test.ts` already proves the
 * roster loads with no registry fault and every prompt file resolves; this
 * file proves the SHAPE of the `gh-issue` entry and its Lifecycle match what
 * the issue asked for, which a registry-fault check does not look at.
 */
const STAMP = join(
  import.meta.dir,
  '..',
  '..',
  '..',
  '..',
  '..',
  'templates',
  'stamp',
  'config',
)

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
    'given the shipped Activity roster',
    'when annotating handoffs are listed for gh-issue',
    'it should include both implicit plan reviewers and the other annotating reviewers in registry order',
  ].join(', '),
  () => {
    // given
    const cfg = shippedConfig()

    // when
    const actual = listAnnotatingHandoffs({
      activities: cfg.activities,
      except: 'gh-issue',
      repoRoot: '/repo',
      handoffDir: '/repo/.pi-crust/data/sessions/run/context_handoff',
    })

    // then
    expect(actual).toBe(
      [
        '- code-review: .pi-crust/data/sessions/run/context_handoff/code_review.md',
        '- outcome-review: .pi-crust/data/sessions/run/context_handoff/outcome_review.md',
        '- plan-comprehension: .pi-crust/data/sessions/run/context_handoff/plan_comprehension.md',
        '- plan-readiness: .pi-crust/data/sessions/run/context_handoff/plan_readiness.md',
      ].join('\n'),
    )
  },
)

test(
  [
    'given the shipped gh-issue user prompt and Activity roster',
    'when its annotating handoffs variable is rendered',
    'it should name both plan review documents without leaving the placeholder',
  ].join(', '),
  () => {
    // given
    const cfg = shippedConfig()
    const activity = cfg.activities.find((one) => one.name === 'gh-issue')
    const annotatingHandoffs = listAnnotatingHandoffs({
      activities: cfg.activities,
      except: 'gh-issue',
      repoRoot: '/repo',
      handoffDir: '/repo/.pi-crust/data/sessions/run/context_handoff',
    })

    // when
    const actual = render(activity?.prompts?.user ?? '', {
      annotating_handoffs: annotatingHandoffs,
    })

    // then
    expect(actual).toContain(
      '- plan-comprehension: .pi-crust/data/sessions/run/context_handoff/plan_comprehension.md',
    )
    expect(actual).toContain(
      '- plan-readiness: .pi-crust/data/sessions/run/context_handoff/plan_readiness.md',
    )
    expect(actual).not.toContain('{{annotating_handoffs}}')
  },
)

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
    'it should derive artifact and issue checks from its output',
  ].join(', '),
  () => {
    // given
    const given = shippedConfig().activities.find(
      (one) => one.name === 'gh-issue',
    )

    // when
    const actual = resolveActivities(
      given === undefined ? [] : [given],
    )[0]?.gates.map((gate) => gate.name)

    // then
    expect(actual).toEqual([
      'artifacts_exist',
      'files_non_empty',
      'json_parses',
      'issue_created',
    ])
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
    const given = shippedConfig().activities.find(
      (one) => one.name === 'gh-issue',
    )

    // when, then
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
    const given = shippedConfig().activities.find(
      (one) => one.name === 'gh-issue',
    )

    // when, then
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
    const given = shippedConfig().activities.find(
      (one) => one.name === 'gh-issue',
    )

    // when, then
    expect(given?.commit).toBe(false)
    expect(given?.attempts).toBe(DEFAULT_ATTEMPTS)
  },
)

test(
  [
    'given use-cases/load-lifecycles::loadLifecycles',
    'when the shipped lifecycles are read',
    'it should file the issue directly after identifying the topic',
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
    expect(actual?.stages).toEqual([
      {
        name: 'discover',
        strategy: 'serial',
        activities: ['identify'],
      },
      { name: 'file', strategy: 'serial', activities: ['gh-issue'] },
    ])
  },
)

test(
  [
    'given use-cases/load-lifecycles::loadLifecycles',
    'when the shipped lifecycles are read',
    'it should review bugfix plans while leaving de-risk unchanged',
  ].join(', '),
  () => {
    // given
    const given = join(STAMP, 'crust.lifecycles.yaml')

    // when
    const actual = loadLifecycles(given, shippedConfig())
    const stagesOf = (name: string) =>
      actual.find((one) => one.name === name)?.stages.map((s) => s.activities)

    // then
    expect(stagesOf('bugfix')).toEqual([
      ['diagnose', 'plan'],
      ['plan-comprehension', 'plan-readiness'],
      ['build'],
      ['outcome-review', 'code-review'],
      ['gh-pull-request'],
    ])
    expect(stagesOf('de-risk')).toEqual([['identify'], ['plan', 'build']])
  },
)
