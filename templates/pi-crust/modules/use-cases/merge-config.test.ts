import { expect, test } from 'bun:test'
import { applyLocalOverrides, localConfigPath } from './merge-config'

const roster = () => ({
  defaults: { model: 'base', thinking: 'medium', protected_files: ['a/'] },
  agents: [
    { name: 'scout', model: 'base', thinking: 'low', writes: [], color: 'amber' },
    { name: 'builder', model: 'dear', thinking: 'high', writes: undefined },
  ],
})

test(
  [
    'given use-cases/merge-config::localConfigPath',
    'when a config path is in force',
    'it should look for the local layer beside it, not at a fixed path',
  ].join(' '),
  () => {
    // given
    const configured = 'somewhere/else/other.yaml'

    // when
    const local = localConfigPath(configured)

    // then
    expect(local).toBe('somewhere/else/other.local.yaml')
  },
)

test(
  [
    'given use-cases/merge-config::applyLocalOverrides',
    'when one agent model is overridden',
    'it should patch that agent and leave every other field and agent alone',
  ].join(' '),
  () => {
    // given
    const local = { agents: [{ name: 'builder', model: 'mine' }] }

    // when
    const applied = applyLocalOverrides(roster(), local) as {
      document: { agents: readonly Record<string, unknown>[] }
      warnings: readonly string[]
    }

    // then
    expect(applied.document.agents[1]).toEqual({
      name: 'builder',
      model: 'mine',
      thinking: 'high',
      writes: undefined,
    })
    expect(applied.document.agents[0]).toEqual(roster().agents[0])
    expect(applied.warnings).toEqual([])
  },
)

test(
  [
    'given use-cases/merge-config::applyLocalOverrides',
    'when the local layer sets a default model',
    'it should keep the other defaults, so one line re-models the roster',
  ].join(' '),
  () => {
    // given
    const local = { defaults: { model: 'mine' } }

    // when
    const applied = applyLocalOverrides(roster(), local) as {
      document: { defaults: Record<string, unknown> }
    }

    // then
    expect(applied.document.defaults).toEqual({
      model: 'mine',
      thinking: 'medium',
      protected_files: ['a/'],
    })
  },
)

test(
  [
    'given use-cases/merge-config::applyLocalOverrides',
    'when the local layer tries to widen an agent writes list',
    'it should REFUSE, because a reviewed boundary is not one person to move',
  ].join(' '),
  () => {
    // given
    const local = { agents: [{ name: 'scout', writes: ['src/'] }] }

    // when
    const attempt = () => applyLocalOverrides(roster(), local)

    // then
    expect(attempt).toThrow(/may only override/)
    expect(attempt).toThrow(/agents\[scout\]: 'writes'/)
  },
)

test(
  [
    'given use-cases/merge-config::applyLocalOverrides',
    'when the local layer tries to change protected_files',
    'it should refuse that too, naming the key rather than dropping it',
  ].join(' '),
  () => {
    // given
    const local = { defaults: { protected_files: [] } }

    // when
    const attempt = () => applyLocalOverrides(roster(), local)

    // then
    expect(attempt).toThrow(/defaults: 'protected_files'/)
  },
)

test(
  [
    'given use-cases/merge-config::applyLocalOverrides',
    'when the local layer tries to change routing',
    'it should refuse: which checks must pass is the repository standard',
  ].join(' '),
  () => {
    // given
    const local = { routing: { checks: [] } }

    // when
    const attempt = () => applyLocalOverrides(roster(), local)

    // then
    expect(attempt).toThrow(/top-level 'routing'/)
  },
)

test(
  [
    'given use-cases/merge-config::applyLocalOverrides',
    'when the local layer names an agent the roster does not have',
    'it should warn and carry on, never add it and never fail the run',
  ].join(' '),
  () => {
    // given
    const local = { agents: [{ name: 'tinkerer', model: 'mine' }] }

    // when
    const applied = applyLocalOverrides(roster(), local) as {
      document: { agents: readonly { name: string }[] }
      warnings: readonly string[]
    }

    // then
    expect(applied.document.agents.map((agent) => agent.name)).toEqual([
      'scout',
      'builder',
    ])
    expect(applied.warnings).toHaveLength(1)
    expect(applied.warnings[0]).toContain('tinkerer')
  },
)

test(
  [
    'given use-cases/merge-config::applyLocalOverrides',
    'when all four overridable keys are used at once',
    'it should accept every one of them',
  ].join(' '),
  () => {
    // given
    const local = {
      agents: [
        {
          name: 'scout',
          model: 'mine',
          thinking: 'xhigh',
          color: 'cyan',
          coding_agent: 'claude_code',
        },
      ],
    }

    // when
    const applied = applyLocalOverrides(roster(), local) as {
      document: { agents: readonly Record<string, unknown>[] }
    }

    // then
    expect(applied.document.agents[0]).toMatchObject({
      model: 'mine',
      thinking: 'xhigh',
      color: 'cyan',
      coding_agent: 'claude_code',
    })
  },
)

test(
  [
    'given use-cases/merge-config::applyLocalOverrides',
    'when the local file is empty',
    'it should hand back the roster untouched rather than erase it',
  ].join(' '),
  () => {
    // given — an empty YAML document parses to null
    const local = undefined

    // when
    const applied = applyLocalOverrides(roster(), local)

    // then
    expect(applied.document).toEqual(roster())
    expect(applied.warnings).toEqual([])
  },
)

test(
  [
    'given use-cases/merge-config::applyLocalOverrides',
    'when the local layer sets its own step order and hides steps',
    'it should accept both, because neither changes what can run',
  ].join(' '),
  () => {
    // given
    const local = { steps: { order: ['build', 'plan'], hidden: ['poc'] } }

    // when
    const applied = applyLocalOverrides(roster(), local) as {
      document: { steps: { order: readonly string[]; hidden: readonly string[] } }
    }

    // then
    expect(applied.document.steps.order).toEqual(['build', 'plan'])
    expect(applied.document.steps.hidden).toEqual(['poc'])
  },
)

test(
  [
    'given use-cases/merge-config::applyLocalOverrides',
    'when the local layer invents a key under steps',
    'it should refuse by name, as it does everywhere else',
  ].join(' '),
  () => {
    // given
    const local = { steps: { disabled: ['code-review'] } }

    // when
    const attempt = () => applyLocalOverrides(roster(), local)

    // then
    expect(attempt).toThrow(/steps: 'disabled'/)
  },
)
