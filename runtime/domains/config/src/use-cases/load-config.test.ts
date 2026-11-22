import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { runnableActivities } from '../../../activities'
import {
  configProvenance,
  loadConfig,
  loadConfigWithNotes,
  parseConfig,
  resolveAgent,
} from './load-config'

for (const scenario of [
  {
    name: 'shared registry gates',
    files: {
      'crust.activities.yaml': 'activities: [{name: build, gates: []}]',
    },
    expected: ['crust.activities.yaml: activities[build].gates'],
  },
  {
    name: 'routing skills',
    files: { 'crust.config.yaml': 'routing: {skills: []}' },
    expected: ['crust.config.yaml: routing.skills'],
  },
  {
    name: 'local registry gates',
    files: {
      'crust.activities.local.yaml': 'activities: [{name: spike, gates: []}]',
    },
    expected: ['crust.activities.local.yaml: activities[spike].gates'],
  },
  {
    name: 'machine override',
    files: { 'machine.yaml': 'override: {agents: [{name: build, gates: []}]}' },
    expected: ['machine.yaml (override:): agents[build].gates'],
  },
  {
    name: 'faults across files',
    files: {
      'crust.config.yaml': 'routing: {skills: []}',
      'crust.config.local.yaml':
        'routing: {checks: [{name: lint, area: backend}]}',
    },
    expected: [
      'crust.config.yaml: routing.skills',
      'crust.config.local.yaml: routing.checks[lint].area',
    ],
  },
]) {
  test(
    [
      `given removed settings in ${scenario.name}`,
      'when loading configuration layers',
      'it should refuse before resolution and name every occurrence and file',
    ].join(', '),
    () => {
      // given
      const dir = mkdtempSync(join(tmpdir(), 'crust-removed-layers-'))
      const previous = process.env.CRUST_MACHINE_CONFIG
      writeFileSync(join(dir, 'crust.config.yaml'), 'agents: []')
      for (const [name, text] of Object.entries(scenario.files)) {
        writeFileSync(join(dir, name), text)
      }
      // biome-ignore lint/plugin/no-object-mutation: process.env is the external configuration API; isolate the machine layer for this test
      process.env.CRUST_MACHINE_CONFIG = join(dir, 'machine.yaml')
      try {
        // when
        const actual = () => loadConfigWithNotes(join(dir, 'crust.config.yaml'))
        // then
        expect(actual).toThrow(
          'this configuration still carries settings pi-crust has removed:',
        )
        for (const location of scenario.expected)
          expect(actual).toThrow(location)
        expect(actual).toThrow('delete this key.')
      } finally {
        if (previous === undefined) delete process.env.CRUST_MACHINE_CONFIG
        // biome-ignore lint/plugin/no-object-mutation: restore the external configuration API after this test
        else process.env.CRUST_MACHINE_CONFIG = previous
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )
}

const ROSTER = `
defaults:
  model: google/gemini-3.6-flash
  thinking: medium
  tools: [read, bash]
  data_dir: .pi-crust/data
agents:
  - name: planner
    thinking: high
    writes: [specs/]
    prompts:
      system: .pi-crust/prompts/plan/system.md
      user: .pi-crust/prompts/plan/user.md
  - name: scout
    writes: []
    tools: [read]
    prompts:
      system: .pi-crust/prompts/scout/system.md
      user: .pi-crust/prompts/scout/user.md
`

test(
  [
    'given use-cases/load-config::parseConfig',
    'when an agent omits a key the defaults set',
    'it should inherit the default',
  ].join(', '),
  () => {
    // given
    const yaml = ROSTER

    // when
    const actual = resolveAgent(parseConfig(yaml), 'planner')

    // then
    expect(actual.model).toEqual('google/gemini-3.6-flash')
    expect(actual.tools).toEqual(['read', 'bash'])
  },
)

test(
  [
    'given use-cases/load-config::parseConfig',
    'when an agent states its own value',
    'it should win over the default',
  ].join(', '),
  () => {
    // given
    const yaml = ROSTER

    // when
    const actual = resolveAgent(parseConfig(yaml), 'scout')

    // then
    expect(actual.thinking).toEqual('medium')
    expect(actual.tools).toEqual(['read'])
  },
)

test(
  [
    'given use-cases/load-config::parseConfig',
    'when an agent declares writes as an empty list',
    'it should stay empty, and not inherit the default the other keys do',
  ].join(', '),
  () => {
    // given
    const yaml = ROSTER

    // when
    const parsed = parseConfig(yaml)

    // then
    expect(resolveAgent(parsed, 'scout').writes).toEqual([])
    expect(resolveAgent(parsed, 'planner').writes).toEqual(['specs/'])
  },
)

test(
  [
    'given use-cases/load-config::parseConfig',
    'when the document omits observability entirely',
    'it should fall back to the stamped trace db path',
  ].join(', '),
  () => {
    // given
    const yaml = 'agents: []'

    // when
    const actual = parseConfig(yaml)

    // then
    expect(actual.observability.db).toEqual('.pi-crust/data/crust.db')
    expect(actual.defaults.data_dir).toEqual('.pi-crust/data')
  },
)

test(
  [
    'given use-cases/load-config::resolveAgent',
    'when the name is not in the roster',
    'it should throw listing what is available',
  ].join(', '),
  () => {
    // given
    const parsed = parseConfig(ROSTER)

    // when, then
    expect(() => resolveAgent(parsed, 'tester')).toThrow(
      /not defined in the config — available: planner, scout/,
    )
  },
)

test(
  [
    'given use-cases/load-config::parseConfig',
    'when an agent declares no writes at all',
    'it should refuse, because silence used to grant the widest permission',
  ].join(', '),
  () => {
    // given
    const yaml = `
agents:
  - name: drifter
    prompts:
      system: s.md
      user: u.md
`

    // when
    const actual = () => parseConfig(yaml)

    // then
    expect(actual).toThrow()
  },
)

/** A stamp on disk, because this is the one thing that is about files. */
const stamped = (files: Readonly<Record<string, string>>): string => {
  const config = join(mkdtempSync(join(tmpdir(), 'crust-config-')), 'config')
  mkdirSync(config, { recursive: true })
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(config, name), text)
  }

  return join(config, 'crust.config.yaml')
}

test(
  [
    'given use-cases/load-config::loadConfig',
    'when observability lives in crust.observe.yaml beside the roster',
    'it should be read from there, under the key every caller already uses',
  ].join(', '),
  () => {
    // given
    const path = stamped({
      'crust.config.yaml': 'agents: []\n',
      'crust.observe.yaml':
        'db: .pi-crust/data/other.db\npoll_ms: 100\n' +
        'ports:\n  backend: 5600\n  frontend: 5601\n' +
        'themes:\n  - name: dark\n    builtin: true\n',
    })
    // Isolated from whatever machine layer this developer's own $HOME may
    // carry (issue #24): a path naming no file reads as 'no machine config'
    // regardless of what ~/.pi-crust/config/crust.config.yaml says on the
    // machine the suite happens to run on.
    const previous = process.env.CRUST_MACHINE_CONFIG
    // biome-ignore lint/plugin/no-object-mutation: process.env is the external API loadConfigWithNotes reads, and this fixture is the adapter that owns the assignment
    process.env.CRUST_MACHINE_CONFIG = join(
      dirname(path),
      'no-machine-config.yaml',
    )

    // when
    try {
      const actual = loadConfig(path)
      // then
      expect(actual.observability.db).toEqual('.pi-crust/data/other.db')
      expect(actual.observability.poll_ms).toBe(100)
      expect(actual.observability.ports).toEqual({
        backend: 5600,
        frontend: 5601,
      })
    } finally {
      if (previous === undefined) {
        delete process.env.CRUST_MACHINE_CONFIG
      } else {
        // biome-ignore lint/plugin/no-object-mutation: restoring the external process.env to what it was before this fixture changed it
        process.env.CRUST_MACHINE_CONFIG = previous
      }
    }
  },
)

test(
  [
    'given use-cases/load-config::loadConfig',
    'when a local layer overrides one port of the observe file',
    'it should win there and leave the rest of the file standing',
  ].join(', '),
  () => {
    // given
    const path = stamped({
      'crust.config.yaml': 'agents: []\n',
      'crust.observe.yaml':
        'poll_ms: 500\nports:\n  backend: 4600\n  frontend: 4601\n',
      'crust.config.local.yaml':
        'observability:\n  poll_ms: 250\n  ports:\n    frontend: 4701\n',
    })

    // when
    const actual = loadConfig(path)

    // then
    expect(actual.observability.poll_ms).toBe(250)
    expect(actual.observability.ports.frontend).toBe(4701)
    expect(actual.observability.ports.backend).toBe(4600)
  },
)

test(
  [
    'given use-cases/load-config::loadConfig',
    'when a tree has no crust.observe.yaml, as an older stamp does not',
    'it should keep the defaults rather than fail to load the roster',
  ].join(', '),
  () => {
    // given
    const path = stamped({ 'crust.config.yaml': 'agents: []\n' })
    // Isolated from this developer's own $HOME machine layer — see the
    // identically-reasoned fixture two tests above.
    const previous = process.env.CRUST_MACHINE_CONFIG
    // biome-ignore lint/plugin/no-object-mutation: process.env is the external API loadConfigWithNotes reads, and this fixture is the adapter that owns the assignment
    process.env.CRUST_MACHINE_CONFIG = join(
      dirname(path),
      'no-machine-config.yaml',
    )

    // when
    try {
      const actual = loadConfig(path)
      // then
      expect(actual.observability.db).toEqual('.pi-crust/data/crust.db')
      expect(actual.observability.ports).toEqual({
        backend: 4600,
        frontend: 4601,
      })
    } finally {
      if (previous === undefined) {
        delete process.env.CRUST_MACHINE_CONFIG
      } else {
        // biome-ignore lint/plugin/no-object-mutation: restoring the external process.env to what it was before this fixture changed it
        process.env.CRUST_MACHINE_CONFIG = previous
      }
    }
  },
)

const ACTIVITIES = `
activities:
  - name: plan
    output: planOutput
    purpose: Turn the request into an implementable plan
    writes: ['{handoff}/plan.md']
    prompts:
      system: prompts/plan/system.md
      user: prompts/plan/user.md
planners:
  - name: operator
    purpose: Choose the smallest chain that can produce the outcome
    writes: ['{handoff}/plan.md']
    prompts:
      system: prompts/operator/system.md
      user: prompts/operator/user.md
  - name: triage
    purpose: Choose the chain and hand it back as a command
    writes: ['{handoff}/plan.md']
    prompts:
      system: prompts/triage/system.md
      user: prompts/triage/user.md
terminal:
  - name: gh-pull-request
    purpose: Push the run's branch and open or update one GitHub pull request
    writes: []
    prompts:
      system: prompts/gh-pull-request/system.md
      user: prompts/gh-pull-request/user.md
`

test(
  [
    'given use-cases/load-config::loadConfig',
    'when a team adds an Activity in a LOCAL layer only',
    'it should be registered, resolvable and runnable without editing this package',
  ].join(', '),
  () => {
    // given
    /*
     * This is the whole point of the registry being configuration.
     * Before it, a team could add an agent and never reach it: nothing bound
     * a activity to it.
     */
    const path = stamped({
      'crust.config.yaml': 'defaults:\n  data_dir: .pi-crust/data\n',
      'crust.activities.yaml': ACTIVITIES,
      'crust.activities.local.yaml': `
activities:
  - name: spike
    output: researchOutput
    attempts: 1
    purpose: Answer one throwaway question without touching the repository
    writes: ['{handoff}/spike.md']
    prompts:
      system: prompts/spike/system.md
      user: prompts/spike/user.md
`,
    })

    // when
    const cfg = loadConfig(path)
    const actual = runnableActivities(['plan', 'spike'], cfg)

    // then — registered, on the roster, and resolved into something runnable
    expect(cfg.activities.map((one) => one.name)).toEqual(['plan', 'spike'])
    expect(cfg.agents.map((one) => one.name)).toContain('spike')
    expect(actual.map((activity) => activity.params.owner)).toEqual([
      'plan',
      'spike',
    ])
    expect(actual[1]?.attempts).toEqual(1)
    expect(actual[1]?.gates.map((gate) => gate.name)).toEqual([
      'artifacts_exist',
      'files_non_empty',
      'json_parses',
    ])
  },
)

test(
  [
    'given use-cases/load-config::loadConfig',
    'when a local layer tunes a Planner',
    'it should take the override and keep the Planner the engine knows',
  ].join(', '),
  () => {
    // given
    const path = stamped({
      'crust.config.yaml': 'defaults: {}\n',
      'crust.activities.yaml': ACTIVITIES,
      'crust.activities.local.yaml':
        'planners:\n  - name: triage\n    model: anthropic/claude-haiku-4-5\n',
    })

    // when
    const actual = loadConfig(path)

    // then
    expect(actual.planners.map((one) => one.name)).toEqual([
      'operator',
      'triage',
    ])
    expect(actual.planners.find((one) => one.name === 'triage')?.model).toEqual(
      'anthropic/claude-haiku-4-5',
    )
  },
)

test(
  [
    'given use-cases/load-config::loadConfig',
    'when a terminal: entry is declared',
    'it should reach cfg.terminal and resolve on cfg.agents, the way a Planner does',
  ].join(', '),
  () => {
    // given
    const path = stamped({
      'crust.config.yaml': 'defaults: {}\n',
      'crust.activities.yaml': ACTIVITIES,
    })

    // when
    const actual = loadConfig(path)

    // then
    expect(actual.terminal.map((one) => one.name)).toEqual(['gh-pull-request'])
    expect(actual.agents.map((one) => one.name)).toContain('gh-pull-request')
    expect(resolveAgent(actual, 'gh-pull-request').prompts.system).toEqual(
      'prompts/gh-pull-request/system.md',
    )
  },
)

test(
  [
    'given use-cases/load-config::loadConfig',
    'when a local layer tunes the terminal Activity',
    'it should take the override and keep gh-pull-request the only terminal entry',
  ].join(', '),
  () => {
    // given
    const path = stamped({
      'crust.config.yaml': 'defaults: {}\n',
      'crust.activities.yaml': ACTIVITIES,
      'crust.activities.local.yaml':
        'terminal:\n  - name: gh-pull-request\n    model: anthropic/claude-haiku-4-5\n',
    })

    // when
    const actual = loadConfig(path)

    // then
    expect(actual.terminal.map((one) => one.name)).toEqual(['gh-pull-request'])
    expect(
      actual.terminal.find((one) => one.name === 'gh-pull-request')?.model,
    ).toEqual('anthropic/claude-haiku-4-5')
  },
)

test(
  [
    'given use-cases/load-config::loadConfig',
    'when a file puts something under terminal: that is not a terminal Activity',
    'it should refuse, because configuration cannot add one',
  ].join(', '),
  () => {
    // given
    const path = stamped({
      'crust.config.yaml': 'defaults: {}\n',
      'crust.activities.yaml': ACTIVITIES.replace(
        '  - name: gh-pull-request',
        [
          '  - name: gh-merge-request',
          '    purpose: Open a GitLab merge request, differently',
          '    writes: []',
          '    prompts:',
          '      system: s.md',
          '      user: u.md',
          '  - name: gh-pull-request',
        ].join('\n'),
      ),
    })

    // when
    const actual = () => loadConfig(path)

    // then
    expect(actual).toThrow(
      /'gh-merge-request' is under terminal: and is not a terminal Activity/,
    )
  },
)

test(
  [
    'given use-cases/load-config::loadConfig',
    'when a file puts something under planners: that is not a Planner',
    'it should refuse, because configuration cannot add one',
  ].join(', '),
  () => {
    // given
    const path = stamped({
      'crust.config.yaml': 'defaults: {}\n',
      'crust.activities.yaml': ACTIVITIES.replace(
        'terminal:',
        [
          '  - name: strategist',
          '    purpose: Choose the chain, differently',
          '    writes: []',
          '    prompts:',
          '      system: s.md',
          '      user: u.md',
          'terminal:',
        ].join('\n'),
      ),
    })

    // when
    const actual = () => loadConfig(path)

    // then
    expect(actual).toThrow(
      /'strategist' is under planners: and is not a Planner/,
    )
  },
)

test(
  [
    'given use-cases/load-config::loadConfig',
    'when a Planner has no entry at all',
    'it should refuse, because configuration cannot remove one either',
  ].join(', '),
  () => {
    // given
    const path = stamped({
      'crust.config.yaml': 'defaults: {}\n',
      'crust.activities.yaml': ACTIVITIES.split('- name: triage')[0] ?? '',
    })

    // when
    const actual = () => loadConfig(path)

    // then
    expect(actual).toThrow(/planner 'triage' has no entry/)
  },
)

test(
  [
    'given use-cases/load-config::loadConfig',
    'when an Activity states no model',
    'it should inherit the roster default rather than a model in this package',
  ].join(', '),
  () => {
    // given — `defaults.model` is the one knob crust.config.yaml documents,
    // and the registry schema's own fallback used to win over it silently
    const dir = mkdtempSync(join(tmpdir(), 'crust-inherit-'))
    writeFileSync(
      join(dir, 'crust.config.yaml'),
      'defaults:\n  model: anthropic/claude-sonnet-5\n  thinking: high\n',
    )
    writeFileSync(
      join(dir, 'crust.activities.yaml'),
      [
        'activities:',
        '  - name: plan',
        '    writes: []',
        '    prompts:',
        '      system: s.md',
        '      user: u.md',
        '  - name: build',
        '    model: openai/gpt-5.6-terra',
        '    writes: []',
        '    prompts:',
        '      system: s.md',
        '      user: u.md',
        'planners:',
        '  - name: operator',
        '    writes: []',
        '    prompts:',
        '      system: s.md',
        '      user: u.md',
        '  - name: triage',
        '    writes: []',
        '    prompts:',
        '      system: s.md',
        '      user: u.md',
        'terminal:',
        '  - name: gh-pull-request',
        '    writes: []',
        '    prompts:',
        '      system: s.md',
        '      user: u.md',
      ].join('\n'),
    )

    // when
    const actual = loadConfig(join(dir, 'crust.config.yaml'))
    const modelOf = (name: string) =>
      actual.activities.find((one) => one.name === name)?.model

    // then — inherited where silent, kept where stated
    expect(modelOf('plan')).toEqual('anthropic/claude-sonnet-5')
    expect(modelOf('build')).toEqual('openai/gpt-5.6-terra')
    expect(actual.planners[0]?.model).toEqual('anthropic/claude-sonnet-5')
    expect(
      actual.activities.find((one) => one.name === 'plan')?.thinking,
    ).toEqual('high')
  },
)

test(
  [
    'given use-cases/load-config::loadConfig',
    'when the repository states data_dir and the machine layer also does, ordinary vs override',
    'it should let the repository win over the ordinary layer and lose to override: (1.2.3, 1.2.4)',
  ].join(', '),
  () => {
    // given — a repository config that states its own data_dir, exactly as
    // every stamp does today
    const dir = mkdtempSync(join(tmpdir(), 'crust-config-machine-'))
    const configPath = join(dir, 'crust.config.yaml')
    writeFileSync(
      configPath,
      [
        'defaults:',
        '  data_dir: repo-stated-dir',
        'agents:',
        '  - name: builder',
        '    writes: []',
        '    prompts:',
        '      system: s.md',
        '      user: u.md',
      ].join('\n'),
    )
    const machinePath = join(dir, 'machine-crust.config.yaml')
    writeFileSync(
      machinePath,
      [
        'defaults:',
        '  data_dir: machine-ordinary-dir',
        'override:',
        '  defaults:',
        '    data_dir: machine-override-dir',
      ].join('\n'),
    )
    const previous = process.env.CRUST_MACHINE_CONFIG
    // biome-ignore lint/plugin/no-object-mutation: process.env is the external API loadConfigWithNotes reads, and this fixture is the adapter that owns the assignment
    process.env.CRUST_MACHINE_CONFIG = machinePath

    // when, then — the repository's own value beats the ordinary layer
    try {
      const ordinaryBeaten = loadConfig(configPath)
      expect(ordinaryBeaten.defaults.data_dir).toEqual('machine-override-dir')
    } finally {
      if (previous === undefined) {
        delete process.env.CRUST_MACHINE_CONFIG
      } else {
        // biome-ignore lint/plugin/no-object-mutation: restoring the external process.env to what it was before this fixture changed it
        process.env.CRUST_MACHINE_CONFIG = previous
      }
    }
  },
)

test(
  [
    'given use-cases/load-config::loadConfig',
    'when the machine layer only has an ordinary section and the repository states nothing',
    'it should fall through to the machine ordinary value',
  ].join(', '),
  () => {
    // given
    const dir = mkdtempSync(join(tmpdir(), 'crust-config-machine-ordinary-'))
    const configPath = join(dir, 'crust.config.yaml')
    writeFileSync(
      configPath,
      [
        'agents:',
        '  - name: builder',
        '    writes: []',
        '    prompts:',
        '      system: s.md',
        '      user: u.md',
      ].join('\n'),
    )
    const machinePath = join(dir, 'machine-crust.config.yaml')
    writeFileSync(
      machinePath,
      ['defaults:', '  data_dir: machine-ordinary-dir'].join('\n'),
    )
    const previous = process.env.CRUST_MACHINE_CONFIG
    // biome-ignore lint/plugin/no-object-mutation: process.env is the external API loadConfigWithNotes reads, and this fixture is the adapter that owns the assignment
    process.env.CRUST_MACHINE_CONFIG = machinePath

    // when
    try {
      const actual = loadConfig(configPath)
      // then
      expect(actual.defaults.data_dir).toEqual('machine-ordinary-dir')
    } finally {
      if (previous === undefined) {
        delete process.env.CRUST_MACHINE_CONFIG
      } else {
        // biome-ignore lint/plugin/no-object-mutation: restoring the external process.env to what it was before this fixture changed it
        process.env.CRUST_MACHINE_CONFIG = previous
      }
    }
  },
)

test(
  [
    'given use-cases/load-config::configProvenance',
    'when a key is stated nowhere at all',
    'it should name the built-in default as its source',
  ].join(', '),
  () => {
    // given
    const dir = mkdtempSync(join(tmpdir(), 'crust-provenance-builtin-'))
    const configPath = join(dir, 'crust.config.yaml')
    writeFileSync(configPath, 'agents: []')

    // when
    const actual = configProvenance(configPath)
    const thinking = actual.find((entry) => entry.key === 'defaults.thinking')

    // then
    expect(thinking?.value).toEqual('medium')
    expect(thinking?.source).toContain('built-in default')
  },
)

test(
  [
    'given use-cases/load-config::configProvenance',
    'when the repository states a value itself',
    'it should name the repository\u2019s own config path as the source',
  ].join(', '),
  () => {
    // given
    const dir = mkdtempSync(join(tmpdir(), 'crust-provenance-repo-'))
    const configPath = join(dir, 'crust.config.yaml')
    writeFileSync(
      configPath,
      'defaults:\n  data_dir: repo-stated-dir\nagents: []',
    )
    // Isolated from this developer's own $HOME machine layer — see the
    // identically-reasoned loadConfig fixtures above.
    const previous = process.env.CRUST_MACHINE_CONFIG
    // biome-ignore lint/plugin/no-object-mutation: process.env is the external API configProvenance reads, and this fixture is the adapter that owns the assignment
    process.env.CRUST_MACHINE_CONFIG = join(dir, 'no-machine-config.yaml')

    // when
    try {
      const actual = configProvenance(configPath)
      const dataDir = actual.find((entry) => entry.key === 'defaults.data_dir')
      // then
      expect(dataDir?.value).toEqual('repo-stated-dir')
      expect(dataDir?.source).toEqual(`${configPath} (repository, committed)`)
    } finally {
      if (previous === undefined) {
        delete process.env.CRUST_MACHINE_CONFIG
      } else {
        // biome-ignore lint/plugin/no-object-mutation: restoring the external process.env to what it was before this fixture changed it
        process.env.CRUST_MACHINE_CONFIG = previous
      }
    }
  },
)

test(
  [
    'given use-cases/load-config::configProvenance',
    'when the machine override: layer beats a value the repository also states',
    'it should name the machine file as the source, not the repository',
  ].join(', '),
  () => {
    // given
    const dir = mkdtempSync(join(tmpdir(), 'crust-provenance-override-'))
    const configPath = join(dir, 'crust.config.yaml')
    writeFileSync(
      configPath,
      'defaults:\n  data_dir: repo-stated-dir\nagents: []',
    )
    const machinePath = join(dir, 'machine-crust.config.yaml')
    writeFileSync(
      machinePath,
      ['override:', '  defaults:', '    data_dir: machine-override-dir'].join(
        '\n',
      ),
    )
    const previous = process.env.CRUST_MACHINE_CONFIG
    // biome-ignore lint/plugin/no-object-mutation: process.env is the external API configProvenance reads, and this fixture is the adapter that owns the assignment
    process.env.CRUST_MACHINE_CONFIG = machinePath

    // when
    try {
      const actual = configProvenance(configPath)
      const dataDir = actual.find((entry) => entry.key === 'defaults.data_dir')
      // then
      expect(dataDir?.value).toEqual('machine-override-dir')
      expect(dataDir?.source).toEqual(`${machinePath} (machine, override:)`)
    } finally {
      if (previous === undefined) {
        delete process.env.CRUST_MACHINE_CONFIG
      } else {
        // biome-ignore lint/plugin/no-object-mutation: restoring the external process.env to what it was before this fixture changed it
        process.env.CRUST_MACHINE_CONFIG = previous
      }
    }
  },
)

test(
  [
    'given use-cases/load-config::configProvenance',
    'when CRUST_DATA_DIR is set in the environment',
    'it should beat every file-based layer, including the machine override:',
  ].join(', '),
  () => {
    // given
    const dir = mkdtempSync(join(tmpdir(), 'crust-provenance-env-'))
    const configPath = join(dir, 'crust.config.yaml')
    writeFileSync(configPath, 'agents: []')

    // when
    const actual = configProvenance(configPath, { CRUST_DATA_DIR: '/env/data' })
    const dataDir = actual.find((entry) => entry.key === 'defaults.data_dir')

    // then
    expect(dataDir?.source).toEqual('CRUST_DATA_DIR (environment)')
  },
)
