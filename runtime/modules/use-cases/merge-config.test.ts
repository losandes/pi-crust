import { expect, test } from 'bun:test'
import { applyLocalOverrides, localConfigPath } from './merge-config'

const roster = () => ({
  defaults: { model: 'base', thinking: 'medium', protected_files: ['a/'] },
  agents: [
    {
      name: 'scout',
      model: 'base',
      thinking: 'low',
      writes: [],
      color: 'amber',
    },
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
    'when the local layer sets a key that used to be refused',
    'it should apply it, because the file has no second principal to protect',
  ].join(' '),
  () => {
    // given — a boundary was unreachable here on the grounds that an
    // unreviewed file must not move it. Whoever writes this file can edit
    // the committed one instead, so the restriction was friction rather
    // than protection.
    const local = { agents: [{ name: 'scout', writes: ['src/'] }] }

    // when
    const actual = applyLocalOverrides(roster(), local)

    // then
    const agents = (
      actual.document as { agents: { name: string; writes?: string[] }[] }
    ).agents
    expect(agents.find((agent) => agent.name === 'scout')?.writes).toEqual([
      'src/',
    ])
  },
)

test(
  [
    'given use-cases/merge-config::applyLocalOverrides',
    'when the local layer sets a top-level section',
    'it should merge into it rather than replacing the whole section',
  ].join(' '),
  () => {
    // given — one key of observability, not all of it
    const local = { observability: { poll_ms: 250 } }

    // when
    const actual = applyLocalOverrides(
      { ...roster(), observability: { db: 'x.db', poll_ms: 500 } },
      local,
    )

    // then
    expect(
      (actual.document as { observability: unknown }).observability,
    ).toEqual({ db: 'x.db', poll_ms: 250 })
  },
)

test(
  [
    'given use-cases/merge-config::applyLocalOverrides',
    'when the local layer names an agent the config does not have',
    'it should warn and point at the registry, rather than failing a run',
  ].join(' '),
  () => {
    // given — a name goes stale when somebody renames an Activity upstream,
    // and a colleague's private file must not break everyone's runs
    const local = { agents: [{ name: 'ghost', model: 'x' }] }

    // when
    const actual = applyLocalOverrides(roster(), local)

    // then
    expect(actual.warnings[0]).toContain('ghost')
    expect(actual.warnings[0]).toContain('crust.activities.yaml')
  },
)

test(
  [
    'given use-cases/merge-config::applyLocalOverrides',
    'when the local file is empty',
    'it should leave the committed config exactly as it was',
  ].join(' '),
  () => {
    // given — the normal case for most developers most of the time
    const base = roster()

    // when
    const actual = applyLocalOverrides(base, {})

    // then
    expect(actual.document).toEqual(base)
    expect(actual.warnings).toEqual([])
  },
)

test(
  [
    'given use-cases/merge-config::applyLocalOverrides',
    'when several keys are overridden at once',
    'it should apply all of them and disturb nothing else',
  ].join(' '),
  () => {
    // given
    const local = {
      defaults: { model: 'local/model' },
      agents: [{ name: 'scout', thinking: 'low', color: 'cyan' }],
    }

    // when
    const actual = applyLocalOverrides(roster(), local)
    const document = actual.document as {
      defaults: Record<string, unknown>
      agents: Record<string, unknown>[]
    }
    const scout = document.agents.find((agent) => agent.name === 'scout')

    // then
    expect(document.defaults.model).toBe('local/model')
    expect(scout?.thinking).toBe('low')
    expect(scout?.color).toBe('cyan')
    expect(scout?.purpose).toBe(
      (roster() as { agents: Record<string, unknown>[] }).agents.find(
        (agent) => agent.name === 'scout',
      )?.purpose,
    )
  },
)
