import { expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { activityOrder } from '../typedefs/lifecycle'
import { crustConfigSchema } from '../typedefs/config'
import { loadLifecycles, mergeLifecycles } from './load-lifecycles'

const written = (base: string, local?: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'crust-lifecycles-'))
  const path = join(dir, 'crust.lifecycles.yaml')
  writeFileSync(path, base)
  if (local !== undefined) {
    writeFileSync(join(dir, 'crust.lifecycles.local.yaml'), local)
  }
  return path
}

const TEAM = `
lifecycles:
  - name: sdlc
    stages:
      - name: plan
        activities: [plan]
      - name: build
        activities: [build]

`

test(
  [
    'given use-cases/load-lifecycles::loadLifecycles',
    'when only the committed file exists',
    'it should read the lifecycles the team agreed',
  ].join(', '),
  () => {
    // given
    const given = written(TEAM)

    // when
    const actual = loadLifecycles(given)

    // then
    expect(actual.map((one) => one.name)).toEqual(['sdlc'])
  },
)

test(
  [
    'given use-cases/load-lifecycles::loadLifecycles',
    'when a local layer names a lifecycle the team also has',
    'it should replace it rather than splicing two graphs together',
  ].join(', '),
  () => {
    // given
    const given = written(
      TEAM,
      `
lifecycles:
  - name: sdlc
    stages:
      - name: only
        activities: [scout]
`,
    )

    // when
    const actual = loadLifecycles(given)

    // then
    expect(activityOrder(actual[0] ?? { name: '', description: '', stages: [] })).toEqual(['scout'])
  },
)

test(
  [
    'given use-cases/load-lifecycles::loadLifecycles',
    'when a local layer adds a lifecycle the team does not have',
    'it should be available, because the local file is the same person',
  ].join(', '),
  () => {
    // given
    const given = written(
      TEAM,
      `
lifecycles:
  - name: spike
    stages:
      - name: only
        activities: [poc]
`,
    )

    // when
    const actual = loadLifecycles(given).map((one) => one.name)

    // then
    expect(actual).toEqual(['sdlc', 'spike'])
  },
)

test(
  [
    'given use-cases/load-lifecycles::loadLifecycles',
    "when a Lifecycle's stage names an alias and cfg is passed",
    'it should load with the canonical name in stages[].activities',
  ].join(', '),
  () => {
    // given
    const given = written(`
lifecycles:
  - name: sdlc
    stages:
      - name: plan
        activities: [plan]
      - name: pr
        activities: [gh-pr]
`)
    const cfg = crustConfigSchema.parse({
      activities: [
        { name: 'plan', purpose: 'p', prompt_engineering: { system: 's.md', user: 'u.md' } },
        {
          name: 'gh-pull-request',
          purpose: 'p',
          prompt_engineering: { system: 's.md', user: 'u.md' },
          aliases: ['gh-pr'],
        },
      ],
    })

    // when
    const actual = loadLifecycles(given, cfg)

    // then
    expect(activityOrder(actual[0] ?? { name: '', description: '', stages: [] })).toEqual([
      'plan',
      'gh-pull-request',
    ])
  },
)

test(
  [
    'given use-cases/load-lifecycles::loadLifecycles',
    'when two stages in a lifecycle share a name',
    'it should refuse at load rather than three activities into a run',
  ].join(', '),
  () => {
    // given
    const given = written(`
lifecycles:
  - name: doubled
    stages:
      - name: a
        activities: [plan]
      - name: a
        activities: [build]
`)

    // when
    const actual = () => loadLifecycles(given)

    // then
    expect(actual).toThrow(/two stages are named/)
  },
)

test(
  [
    'given use-cases/load-lifecycles::mergeLifecycles',
    'when a local lifecycle replaces one of the team lifecycles',
    'it should hold the place the team file gave it',
  ].join(', '),
  () => {
    // given
    const base = [
      { name: 'a', description: '', stages: [] },
      { name: 'b', description: '', stages: [] },
      { name: 'c', description: '', stages: [] },
    ]
    const local = [{ name: 'b', description: 'mine', stages: [] }]

    // when
    const actual = mergeLifecycles(base, local)

    // then
    expect(actual.map((one) => one.name)).toEqual(['a', 'b', 'c'])
    expect(actual[1]?.description).toBe('mine')
  },
)
