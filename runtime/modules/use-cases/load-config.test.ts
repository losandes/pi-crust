import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig, parseConfig, resolveAgent } from './load-config'
import { resolveSteps } from './steps'

const ROSTER = `
defaults:
  model: google/gemini-3.6-flash
  thinking: medium
  tools: [read, bash]
  harness_engineering: [.pi-crust/harness-engineering/subagents.ts]
  data_dir: .pi-crust/data
agents:
  - name: planner
    thinking: high
    writes: [specs/]
    prompt_engineering:
      system: .pi-crust/prompt-engineering/plan/system.md
      user: .pi-crust/prompt-engineering/plan/user.md
  - name: scout
    writes: []
    tools: [read]
    harness_engineering: []
    prompt_engineering:
      system: .pi-crust/prompt-engineering/scout/system.md
      user: .pi-crust/prompt-engineering/scout/user.md
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
    expect(actual.harness_engineering).toEqual([
      '.pi-crust/harness-engineering/subagents.ts',
    ])
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
    expect(actual.harness_engineering).toEqual([])
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
    prompt_engineering:
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
        "themes:\n  - name: dark\n    builtin: true\n",
    })

    // when
    const actual = loadConfig(path)

    // then
    expect(actual.observability.db).toEqual('.pi-crust/data/other.db')
    expect(actual.observability.poll_ms).toBe(100)
    expect(actual.observability.ports).toEqual({
      backend: 5600,
      frontend: 5601,
    })
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

    // when
    const actual = loadConfig(path)

    // then
    expect(actual.observability.db).toEqual('.pi-crust/data/crust.db')
    expect(actual.observability.ports).toEqual({
      backend: 4600,
      frontend: 4601,
    })
  },
)

const ACTIVITIES = `
activities:
  - name: plan
    output: planOutput
    gates: [artifactsExist]
    purpose: Turn the request into an implementable plan
    writes: ['{handoff}/plan.md']
    prompt_engineering:
      system: prompt-engineering/plan/system.md
      user: prompt-engineering/plan/user.md
planners:
  - name: operator
    purpose: Choose the smallest chain that can produce the outcome
    writes: ['{handoff}/plan.md']
    prompt_engineering:
      system: prompt-engineering/operator/system.md
      user: prompt-engineering/operator/user.md
  - name: triage
    purpose: Choose the chain and hand it back as a command
    writes: ['{handoff}/plan.md']
    prompt_engineering:
      system: prompt-engineering/triage/system.md
      user: prompt-engineering/triage/user.md
`

test(
  [
    'given use-cases/load-config::loadConfig',
    'when a team adds an Activity in a LOCAL layer only',
    'it should be registered, resolvable and runnable without editing this package',
  ].join(', '),
  () => {
    /*
     * given — this is the whole point of the registry being configuration.
     * Before it, a team could add an agent and never reach it: nothing bound
     * a step to it.
     */
    const path = stamped({
      'crust.config.yaml': 'defaults:\n  data_dir: .pi-crust/data\n',
      'crust.activities.yaml': ACTIVITIES,
      'crust.activities.local.yaml': `
activities:
  - name: spike
    output: researchOutput
    gates: [artifactsExist]
    attempts: 1
    purpose: Answer one throwaway question without touching the repository
    writes: ['{handoff}/spike.md']
    prompt_engineering:
      system: prompt-engineering/spike/system.md
      user: prompt-engineering/spike/user.md
`,
    })

    // when
    const cfg = loadConfig(path)
    const actual = resolveSteps(['plan', 'spike'], cfg)

    // then — registered, on the roster, and resolved into something runnable
    expect(cfg.activities.map((one) => one.name)).toEqual(['plan', 'spike'])
    expect(cfg.agents.map((one) => one.name)).toContain('spike')
    expect(actual.map((step) => step.params.owner)).toEqual(['plan', 'spike'])
    expect(actual[1]?.attempts).toEqual(1)
    expect(actual[1]?.gates.map((gate) => gate.name)).toEqual(['artifacts_exist'])
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
    expect(
      actual.planners.find((one) => one.name === 'triage')?.model,
    ).toEqual('anthropic/claude-haiku-4-5')
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
      'crust.activities.yaml': `${ACTIVITIES}
  - name: strategist
    purpose: Choose the chain, differently
    writes: []
    prompt_engineering:
      system: s.md
      user: u.md
`,
    })

    // when
    const actual = () => loadConfig(path)

    // then
    expect(actual).toThrow(/'strategist' is under planners: and is not a Planner/)
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
