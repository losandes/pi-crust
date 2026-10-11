import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { activitiesFileSchema } from '../typedefs/activity'
import { agentConfigSchema } from '../typedefs/config'
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

const shippedAgents = () =>
  activitiesFileSchema
    .parse(
      Bun.YAML.parse(readFileSync(join(STAMP, 'crust.activities.yaml'), 'utf8')),
    )
    .activities.map((one) => agentConfigSchema.parse(one))

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
    const actual = loadLifecycles(given, shippedAgents())

    // then
    expect(actual.map((one) => one.name)).toEqual(['sdlc', 'bugfix', 'de-risk'])
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
    const actual = () => loadLifecycles(given, shippedAgents())

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
    const actual = loadLifecycles(given, shippedAgents())

    // then
    expect(actual).toHaveLength(1)
  },
)
