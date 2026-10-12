import { expect, test } from 'bun:test'
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { activitiesFileSchema } from '../typedefs/activity'
import { crustConfigSchema } from '../typedefs/config'
import type { TPiCrustConfig } from '../typedefs/config'
import { activityOrder, lifecyclesFileSchema } from '../typedefs/lifecycle'
import { loadLifecycles } from './load-lifecycles'

/*
 * The templates a team is actually given, not a fixture shaped like them.
 *
 * A concurrency claim that only ever passes against a hand-written stage is
 * a check nobody has pointed at the thing it exists to protect. These read
 * the shipped files, so the day somebody groups two writers under
 * `concurrent` the suite says so rather than the run doing.
 */
const STAMP = join(import.meta.dir, '../../../templates/stamp/config')

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
    agents: [...registry.activities, ...registry.planners],
  })
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
      join(STAMP, 'crust.lifecycles.local.example.yaml'),
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
      join(STAMP, 'crust.lifecycles.local.example.yaml'),
      join(dir, 'crust.lifecycles.local.yaml'),
    )

    // when
    const actual = loadLifecycles(base, shippedConfig())
    const survey = actual.find((one) => one.name === 'survey')

    // then
    expect(survey?.stages.find((one) => one.name === 'research')?.strategy).toBe(
      'concurrent',
    )
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
    expect(stagesOf('sdlc')).toEqual(['discover', 'deliver', 'accept'])
    expect(stagesOf('bugfix')).toEqual(['diagnose', 'deliver', 'accept'])
    expect(stagesOf('de-risk')).toEqual(['discover', 'prove'])
  },
)

test(
  [
    'given use-cases/load-lifecycles::loadLifecycles',
    'when the shipped sdlc is flattened',
    'it should run the same activities in the same order it always has',
  ].join(', '),
  () => {
    // given
    const given = join(STAMP, 'crust.lifecycles.yaml')

    // when
    const actual = loadLifecycles(given, shippedConfig())
    const sdlc = actual.find((one) => one.name === 'sdlc')

    // then
    expect(activityOrder(sdlc ?? { name: '', description: '', stages: [] })).toEqual([
      'identify',
      'conceptualize',
      'plan',
      'design',
      'build',
      'test',
      'review',
      'code-review',
    ])
  },
)

test(
  [
    'given use-cases/load-lifecycles::loadLifecycles',
    'when a shipped stage is serial',
    'it should be allowed to hold a sequence, which is why there are three of them',
  ].join(', '),
  () => {
    // given
    const given = join(STAMP, 'crust.lifecycles.yaml')

    // when
    const actual = loadLifecycles(given, shippedConfig())
    const sdlc = actual.find((one) => one.name === 'sdlc')
    const deliver = sdlc?.stages.find((one) => one.name === 'deliver')

    // then
    expect(deliver?.strategy).toBe('serial')
    expect(deliver?.activities).toEqual(['plan', 'design', 'build', 'test'])
  },
)
