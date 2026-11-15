import { expect, test } from 'bun:test'
import { crustConfigSchema } from '../../../../lib/contracts'
import { parseModelOverrides } from '../../../cli'
import { applyModelOverrides } from './model-overrides'

const configFor = () => {
  const entries = [
    { name: 'build', aliases: ['b'], attempts: 3, commit: true },
    { name: 'code-review', output: 'reviewOutput' },
    { name: 'ux-design', hidden: true },
  ].map((entry) => ({
    model: 'anthropic/claude-opus-5',
    thinking: 'medium',
    purpose: `Perform ${entry.name}`,
    prompt_engineering: { system: 'system.md', user: 'user.md' },
    tools: ['read'],
    writes: ['src/'],
    harness_engineering: ['extension.ts'],
    ...entry,
  }))
  const planners = ['operator', 'triage'].map((name) => ({
    ...entries[0],
    name,
  }))
  const terminal = [
    {
      ...entries[0],
      name: 'gh-pull-request',
      delivery: { remote: 'upstream', base: 'develop', draft: true },
    },
  ]

  return crustConfigSchema.parse({
    agents: [...entries, ...planners, ...terminal],
    activities: entries,
    planners,
    terminal,
  })
}

test(
  [
    'given use-cases/model-overrides::applyModelOverrides',
    'when a model and thinking override names an activity',
    'it should update both representations, preserve all other fields, and leave the input unchanged',
  ].join(', '),
  () => {
    // given
    const cfg = configFor()
    const before = structuredClone(cfg)
    const { overrides } = parseModelOverrides('build=openai/gpt-5@high')

    // when
    const actual = applyModelOverrides(cfg, overrides, new Set(['build']))

    // then
    expect(actual.warnings).toEqual([])
    expect(actual.config).toEqual({
      ...cfg,
      agents: cfg.agents.map((entry) =>
        entry.name === 'build'
          ? { ...entry, model: 'openai/gpt-5', thinking: 'high' }
          : entry,
      ),
      activities: cfg.activities.map((entry) =>
        entry.name === 'build'
          ? { ...entry, model: 'openai/gpt-5', thinking: 'high' }
          : entry,
      ),
    })
    expect(cfg).toEqual(before)
  },
)

test(
  [
    'given use-cases/model-overrides::applyModelOverrides',
    'when an override uses an activity alias',
    'it should reach the canonical activity and recognise that it runs',
  ].join(', '),
  () => {
    // given
    const cfg = configFor()
    const { overrides } = parseModelOverrides('b=openai/gpt-5')

    // when
    const actual = applyModelOverrides(cfg, overrides, new Set(['build']))

    // then
    expect(actual.warnings).toEqual([])
    expect(actual.config.agents).toEqual(
      cfg.agents.map((entry) =>
        entry.name === 'build' ? { ...entry, model: 'openai/gpt-5' } : entry,
      ),
    )
    expect(actual.config.activities[0]?.model).toBe('openai/gpt-5')
    expect(actual.config.activities[0]?.aliases).toEqual(['b'])
  },
)

test(
  [
    'given use-cases/model-overrides::applyModelOverrides',
    'when only a thinking level is overridden',
    'it should preserve the configured model',
  ].join(', '),
  () => {
    // given
    const cfg = configFor()
    const { overrides } = parseModelOverrides('code-review=@xhigh')

    // when
    const actual = applyModelOverrides(cfg, overrides, new Set(['code-review']))

    // then
    expect(actual.warnings).toEqual([])
    expect(actual.config.activities).toEqual(
      cfg.activities.map((entry) =>
        entry.name === 'code-review' ? { ...entry, thinking: 'xhigh' } : entry,
      ),
    )
    expect(actual.config.agents).toEqual(
      cfg.agents.map((entry) =>
        entry.name === 'code-review' ? { ...entry, thinking: 'xhigh' } : entry,
      ),
    )
  },
)

for (const name of ['operator', 'triage']) {
  test(
    [
      'given use-cases/model-overrides::applyModelOverrides',
      `when an override names the ${name} Planner`,
      'it should update the Planner and its agent entry',
    ].join(', '),
    () => {
      // given
      const cfg = configFor()
      const { overrides } = parseModelOverrides(`${name}=openai/gpt-5@max`)

      // when
      const actual = applyModelOverrides(cfg, overrides, new Set([name]))

      // then
      expect(actual.warnings).toEqual([])
      expect(actual.config.planners).toEqual(
        cfg.planners.map((entry) =>
          entry.name === name
            ? { ...entry, model: 'openai/gpt-5', thinking: 'max' }
            : entry,
        ),
      )
      expect(actual.config.agents).toEqual(
        cfg.agents.map((entry) =>
          entry.name === name
            ? { ...entry, model: 'openai/gpt-5', thinking: 'max' }
            : entry,
        ),
      )
      expect(actual.config.activities).toEqual(cfg.activities)
      expect(actual.config.terminal).toEqual(cfg.terminal)
    },
  )
}

test(
  [
    'given use-cases/model-overrides::applyModelOverrides',
    'when an override names the terminal activity',
    'it should update both representations without changing its delivery settings',
  ].join(', '),
  () => {
    // given
    const cfg = configFor()
    const { overrides } = parseModelOverrides(
      'gh-pull-request=openai/gpt-5@low',
    )

    // when
    const actual = applyModelOverrides(
      cfg,
      overrides,
      new Set(['gh-pull-request']),
    )

    // then
    expect(actual.warnings).toEqual([])
    expect(actual.config.terminal).toEqual(
      cfg.terminal.map((entry) => ({
        ...entry,
        model: 'openai/gpt-5',
        thinking: 'low',
      })),
    )
    expect(actual.config.agents).toEqual(
      cfg.agents.map((entry) =>
        entry.name === 'gh-pull-request'
          ? { ...entry, model: 'openai/gpt-5', thinking: 'low' }
          : entry,
      ),
    )
    expect(actual.config.activities).toEqual(cfg.activities)
    expect(actual.config.planners).toEqual(cfg.planners)
  },
)

test(
  [
    'given use-cases/model-overrides::applyModelOverrides',
    'when a name has no agent entry',
    'it should ignore the override with a warning rather than invent an activity',
  ].join(', '),
  () => {
    // given
    const cfg = configFor()
    const { overrides } = parseModelOverrides('biuld=openai/gpt-5')

    // when
    const actual = applyModelOverrides(cfg, overrides, new Set(['build']))

    // then
    expect(actual).toEqual({
      config: cfg,
      warnings: [
        "--model: no activity named 'biuld' in this repository — ignored",
      ],
    })
  },
)

test(
  [
    'given use-cases/model-overrides::applyModelOverrides',
    'when an existing activity is not used by this run',
    'it should still apply the override and explain that the activity will not run',
  ].join(', '),
  () => {
    // given
    const cfg = configFor()
    const { overrides } = parseModelOverrides('ux-design=@high')

    // when
    const actual = applyModelOverrides(cfg, overrides, new Set(['build']))

    // then
    expect(actual.warnings).toEqual([
      "--model: 'ux-design' does not run in this run — the override has no effect",
    ])
    expect(actual.config.activities).toEqual(
      cfg.activities.map((entry) =>
        entry.name === 'ux-design' ? { ...entry, thinking: 'high' } : entry,
      ),
    )
    expect(actual.config.agents).toEqual(
      cfg.agents.map((entry) =>
        entry.name === 'ux-design' ? { ...entry, thinking: 'high' } : entry,
      ),
    )
  },
)

test(
  [
    'given use-cases/model-overrides::applyModelOverrides',
    'when more than one entry has the matched name',
    'it should update every matching entry without changing their other fields',
  ].join(', '),
  () => {
    // given
    const base = configFor()
    const cfg = crustConfigSchema.parse({
      ...base,
      agents: [...base.agents, { ...base.agents[0], purpose: 'second agent' }],
      activities: [
        ...base.activities,
        { ...base.activities[0], purpose: 'second activity' },
      ],
    })
    const { overrides } = parseModelOverrides('build=openai/gpt-5')

    // when
    const actual = applyModelOverrides(cfg, overrides, new Set(['build']))

    // then
    expect(actual.config.agents).toEqual(
      cfg.agents.map((entry) =>
        entry.name === 'build' ? { ...entry, model: 'openai/gpt-5' } : entry,
      ),
    )
    expect(actual.config.activities).toEqual(
      cfg.activities.map((entry) =>
        entry.name === 'build' ? { ...entry, model: 'openai/gpt-5' } : entry,
      ),
    )
  },
)

test(
  [
    'given use-cases/model-overrides::applyModelOverrides',
    'when the override list is empty',
    'it should return the original config without warnings',
  ].join(', '),
  () => {
    // given
    const cfg = configFor()

    // when
    const actual = applyModelOverrides(cfg, [], new Set(['build']))

    // then
    expect(actual.config).toBe(cfg)
    expect(actual.warnings).toEqual([])
  },
)
