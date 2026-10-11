import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig, parseConfig, resolveAgent } from './load-config'

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
      system: .pi-crust/prompt-engineering/planner/system.md
      user: .pi-crust/prompt-engineering/planner/user.md
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
