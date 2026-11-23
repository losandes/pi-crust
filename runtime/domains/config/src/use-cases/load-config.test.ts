import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { crustConfigSchema } from '../../../../lib/contracts'
import { validateAgents } from '../../../agents'
import { assembleConfig } from './assemble-config'
import { aLayer, layersFixture } from './config-layer-fixture.test'
import {
  loadConfig,
  loadConfigWithNotes,
  resolveAgent,
  resolveConfig,
} from './load-config'

for (const machine of [false, true]) {
  test(
    [
      `given @SC4 @SC7 package and ${machine ? 'machine' : 'repository'} models`,
      'when loading two repositories after a machine edit',
      'it should merge on every load without modifying either repository',
    ].join(', '),
    () => {
      // given
      using f = layersFixture({
        'package/crust.config.toml':
          '[defaults]\nmodel = "package/model"\nthinking = "high"\n',
        'package/crust.activities.toml':
          '[activities.build]\nwrites = ["src/"]\nattempts = 3\npurpose = "Build"\n[planners.operator]\nwrites = []\n[planners.triage]\nwrites = []\n[terminal.gh-pull-request]\nwrites = []\n',
        'machine/crust.activities.toml':
          '[activities.build]\nmodel = "machine/model"\n',
        'repository/pi-crust.toml': machine
          ? '# empty\n'
          : '[activities.build]\nmodel = "repository/model"\n',
      })
      const other = f.write('other/pi-crust.toml', '# empty\n')
      const before = [f.repositoryPath, other].map((path) =>
        readFileSync(path, 'utf8'),
      )
      // when
      const one = loadConfigWithNotes(f.repositoryPath, f.env)
      f.write(
        'machine/crust.activities.toml',
        '[activities.build]\nmodel = "machine/new"\n',
      )
      const two = [f.repositoryPath, other].map(
        (path) => loadConfigWithNotes(path, f.env).config,
      )
      // then
      expect(one.config.activities[0]?.model).toBe(
        machine ? 'machine/model' : 'repository/model',
      )
      expect(two.map((cfg) => cfg.activities[0]?.model)).toEqual([
        machine ? 'machine/new' : 'repository/model',
        'machine/new',
      ])
      expect(two[0]?.activities[0]).toMatchObject({
        purpose: 'Build',
        writes: ['src/'],
        attempts: 3,
        thinking: 'high',
      })
      expect(
        [f.repositoryPath, other].map((path) => readFileSync(path, 'utf8')),
      ).toEqual(before)
      expect(one.machinePath).toBe(f.env.CRUST_MACHINE_CONFIG)
    },
  )
}

test(
  [
    'given @SC6 a package setting',
    'when the package file changes between loads',
    'it should use the changed value without reinstalling',
  ].join(', '),
  () => {
    // given
    using f = layersFixture({
      'package/crust.config.toml': '[defaults]\nmodel = "first"\n',
    })
    const before = loadConfig(f.repositoryPath, f.env)
    f.write('package/crust.config.toml', '[defaults]\nmodel = "second"\n')
    // when
    const after = loadConfig(f.repositoryPath, f.env)
    // then
    expect(before.defaults.model).toBe('first')
    expect(after.defaults.model).toBe('second')
  },
)

for (const [text, message] of [
  [
    'stages = [{ name = "bad", serial = ["build"], concurrent = ["build"] }]',
    'both serial and concurrent',
  ],
  ['stages = [{ name = "bad" }]', 'neither serial nor concurrent'],
  ['stages = [{ name = "bad", serial = [] }]', 'lists no Activities'],
  [
    'stages = [{ name = "bad", strategy = "serial", activities = ["build"] }]',
    "key 'strategy'",
  ],
  ['stages = [{ serial = ["build"] }]', 'position 0'],
]) {
  test(
    [
      `given @SC10 ${text}`,
      'when configuration loads',
      'it should name the lifecycle and malformed stage',
    ].join(', '),
    () => {
      // given
      using f = layersFixture({
        'repository/pi-crust.toml': `[lifecycles.broken]\n${text}\n`,
      })
      // when
      const actual = () => loadConfig(f.repositoryPath, f.env)
      // then
      expect(actual).toThrow('lifecycle configuration cannot load:')
      expect(actual).toThrow('broken:')
      expect(actual).toThrow(message)
    },
  )
}

test(
  [
    'given @SC11 entries in parser order including numeric names',
    'when loaded twice',
    'it should group by first declaration and sort by code unit',
  ].join(', '),
  () => {
    // given
    const declarations = (prefix: string) =>
      ['zeta', '10', 'alpha', '2']
        .map((name) => `[activities.${prefix}${name}]\nwrites = []\n`)
        .join('')
    using f = layersFixture({
      'package/crust.activities.toml': `${declarations('')}[planners.operator]\nwrites = []\n[planners.triage]\nwrites = []\n[terminal.gh-pull-request]\nwrites = []\n`,
      'machine/crust.activities.toml': `${declarations('m-')}[activities.alpha]\nmodel = "override"\n`,
    })
    // when
    const names = () =>
      loadConfig(f.repositoryPath, f.env).activities.map((entry) => entry.name)
    // then
    expect(names()).toEqual([
      '10',
      '2',
      'alpha',
      'zeta',
      'm-10',
      'm-2',
      'm-alpha',
      'm-zeta',
    ])
    expect(names()).toEqual(names())
  },
)

test(
  [
    'given @SC15 an old repository prompt override',
    'when loading a package Activity',
    'it should retain the package prompt directory',
  ].join(', '),
  () => {
    // given
    using f = layersFixture({
      'package/crust.activities.toml':
        '[activities.plan]\nwrites = []\n[planners.operator]\nwrites = []\n[planners.triage]\nwrites = []\n[terminal.gh-pull-request]\nwrites = []\n',
      'repository/.pi-crust/prompts/plan/system.md': 'ignored',
    })
    // when
    const actual = loadConfig(f.repositoryPath, f.env)
    // then
    expect(actual.activities[0]?.prompts).toBe(join(f.root, 'prompts/plan'))
  },
)

test(
  [
    'given @SC16 a machine-only Activity and its required prompts',
    'when loaded and validated',
    'it should resolve beside the machine configuration directory',
  ].join(', '),
  () => {
    // given
    using f = layersFixture({
      'machine/crust.activities.toml': '[activities.spike]\nwrites = []\n',
      'prompts/spike/system.md': 'system',
      'prompts/spike/user.md': 'user',
    })
    // when
    const cfg = loadConfig(f.repositoryPath, f.env)
    const actual = () =>
      validateAgents(cfg, ['spike'], () => ({
        provider: 'fixture',
        modelId: 'model',
      }))
    // then
    expect(resolveAgent(cfg, 'spike').prompts).toBe(
      join(f.root, 'prompts/spike'),
    )
    expect(actual).not.toThrow()
  },
)

test(
  [
    'given @SC19 machine ports and polling interval',
    'when loaded',
    'it should assemble observability from the top-level settings',
  ].join(', '),
  () => {
    // given
    using f = layersFixture({
      'machine/crust.config.toml':
        'poll_ms = 250\n[ports]\nbackend = 4700\nfrontend = 4701\n',
    })
    // when
    const actual = loadConfig(f.repositoryPath, f.env)
    // then
    expect(actual.observability).toMatchObject({
      poll_ms: 250,
      ports: { backend: 4700, frontend: 4701 },
    })
  },
)

for (const [text, message] of [
  [
    '[activities.incomplete]\npurpose = "no writes"\n',
    'activities.incomplete.writes',
  ],
  ['[activities.bad]\nwrites = []\nmodel = 5\n', 'activities.bad.model'],
  ['[planners.strategist]\nwrites = []\n', 'strategist'],
  ['[terminal.other]\nwrites = []\n', 'other'],
  [
    '[tasks.check]\nwhen = [{ before = "missing" }]\nrun = "true"\n',
    "task 'check'",
  ],
  ['override = {}\n', 'section was removed'],
  ['unknown = 1\n', "key 'unknown'"],
  ['[activities.build]\ngates = []\n', 'activities.build.gates'],
] as const) {
  test(
    [
      `given invalid repository settings ${text}`,
      'when loading',
      `it should report ${message}`,
    ].join(', '),
    () => {
      // given
      using f = layersFixture({ 'repository/pi-crust.toml': text })
      // when
      const actual = () => loadConfig(f.repositoryPath, f.env)
      // then
      expect(actual).toThrow(message)
    },
  )
}

test(
  [
    'given defaults and explicit entry values',
    'when resolving an assembled configuration',
    'it should inherit only absent fields and refuse an unknown agent',
  ].join(', '),
  () => {
    // given
    const assembled = assembleConfig([
      aLayer('repository', {
        defaults: {
          model: 'inherited',
          thinking: 'high',
          tools: ['read'],
          writes: ['src/'],
        },
        activities: {
          plan: {},
          scout: { tools: [], writes: [], thinking: 'low' },
        },
        planners: { operator: {}, triage: {} },
        terminal: { 'gh-pull-request': {} },
      }),
    ])
    // when
    const cfg = resolveConfig(assembled.document)
    // then
    expect(resolveAgent(cfg, 'plan')).toMatchObject({
      model: 'inherited',
      thinking: 'high',
      tools: ['read'],
      writes: ['src/'],
    })
    expect(resolveAgent(cfg, 'scout')).toMatchObject({
      tools: [],
      writes: [],
      thinking: 'low',
    })
    expect(() => resolveAgent(cfg, 'missing')).toThrow('available: plan, scout')
  },
)

test(
  [
    'given no Planners or terminal entries and no ordinary Activities',
    'when resolving the configuration',
    'it should still report the required engine entries',
  ].join(', '),
  () => {
    // given
    const document = crustConfigSchema.parse({})
    // when
    const actual = () => resolveConfig(document)
    // then
    expect(actual).toThrow("planner 'operator'")
    expect(actual).toThrow("terminal Activity 'gh-pull-request'")
  },
)

test(
  [
    'given a legacy configuration beside a valid repository file',
    'when loading with a notifier',
    'it should announce the unread file without applying its settings',
  ].join(', '),
  () => {
    // given
    using f = layersFixture({
      'repository/.pi-crust/config/crust.config.yaml':
        'defaults: { model: ignored }',
    })
    const notices: string[] = []
    // when
    const cfg = loadConfig(f.repositoryPath, f.env, (notice) => {
      // biome-ignore lint/plugin/no-array-mutation: recording the injected notification boundary is this test's assertion input
      notices.push(notice)
    })
    // then
    expect(cfg.defaults.model).not.toBe('ignored')
    expect(notices[0]).toContain('not read')
  },
)

for (const layer of ['package', 'machine', 'repository'] as const) {
  test(
    [
      `given db in the ${layer} configuration`,
      'when loading',
      'it should refuse it once with the removal message',
    ].join(', '),
    () => {
      // given
      using f = layersFixture({
        [`${layer}/${layer === 'repository' ? 'pi-crust.toml' : 'crust.config.toml'}`]:
          'db = "old.db"',
      })
      // when
      const load = () => loadConfigWithNotes(f.repositoryPath, f.env)
      // then
      expect(load).toThrow(
        'the trace database is crust.db inside defaults.data_dir',
      )
      expect(load).not.toThrow('unknown top-level key')
    },
  )
  test(
    [
      `given themes in the ${layer} configuration`,
      'when loading',
      'it should ignore the table and warn only outside the machine layer',
    ].join(', '),
    () => {
      // given
      using f = layersFixture({
        [`${layer}/${layer === 'repository' ? 'pi-crust.toml' : 'crust.config.toml'}`]:
          '[themes.x]\nstylesheet = "x.css"',
      })
      // when
      const loaded = loadConfigWithNotes(f.repositoryPath, f.env)
      // then
      expect(loaded.warnings.length).toBe(layer === 'machine' ? 0 : 1)
      expect(Object.keys(loaded.config)).not.toContain('themes')
    },
  )
}
test(
  [
    'given malformed machine themes',
    'when runtime configuration loads',
    'it should not validate viewer registrations',
  ].join(', '),
  () => {
    // given
    using f = layersFixture({ 'machine/crust.config.toml': 'themes = 42' })
    // when
    const loaded = loadConfigWithNotes(f.repositoryPath, f.env)
    // then
    expect(loaded.warnings).toEqual([])
  },
)
