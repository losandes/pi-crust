import { expect, test } from 'bun:test'
import { parseConfig, resolveAgent } from './load-config'

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
    'it should stay an empty list rather than becoming unrestricted',
  ].join(', '),
  () => {
    // given
    const yaml = ROSTER

    // when
    const parsed = parseConfig(yaml)

    // then
    expect(resolveAgent(parsed, 'scout').writes).toEqual([])
    expect(resolveAgent(parsed, 'planner').writes).toBeUndefined()
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
