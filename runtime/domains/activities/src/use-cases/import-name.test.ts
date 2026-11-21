import { expect, test } from 'bun:test'
import {
  activityConfigSchema,
  crustConfigSchema,
  IMPORT_NAME,
  importIn,
  importOutputSchema,
  isImportName,
  lifecycleConfigSchema,
  lifecycleFaults,
  withoutImport,
} from '../../../../lib/contracts'
import { workflowArgs } from '../../../cli'
import { parseActivities } from '../../../planning'
import { registryFaults, resolveActivities } from './activity-registry'
import { runnableActivities, unknownActivities } from './resolve-activities'

const activity = activityConfigSchema.parse({
  name: 'build',
  output: 'buildOutput',
  prompts: { system: 'system.md', user: 'user.md' },
})
for (const { chain, concurrent, count, message } of [
  { chain: ['import', 'build'], concurrent: false, count: 0, message: '' },
  {
    chain: ['build', 'import'],
    concurrent: false,
    count: 1,
    message:
      "'import' is the engine's import step and is named in stage 'deliver' — it may only be the first entry of the first stage, because it runs before any Activity does.",
  },
  {
    chain: ['import', 'build'],
    concurrent: true,
    count: 1,
    message:
      "'import' cannot run in a concurrent stage ('deliver') — it runs before any Activity does. It must be the first entry of a serial first stage.",
  },
]) {
  test(
    [
      'given an import placement',
      `when ${chain.join(',')} is ${concurrent ? 'concurrent' : 'serial'}`,
      'it should validate the position with its fixed message',
    ].join(', '),
    () => {
      // given
      const lifecycle = lifecycleConfigSchema.parse({
        name: 'delivery',
        stages: [
          {
            name: 'deliver',
            strategy: concurrent ? 'concurrent' : 'serial',
            activities: chain,
          },
        ],
      })
      // when
      const faults = lifecycleFaults(lifecycle)
      // then
      expect(faults).toHaveLength(count)
      if (count > 0) expect(faults[0]?.message).toBe(message)
      expect(importIn(lifecycle.stages)).toBe(true)
      expect(withoutImport(lifecycle.stages)[0]?.activities).toEqual(['build'])
    },
  )
}

test(
  [
    'given an import-only stage followed by work',
    'when removing engine steps',
    'it should drop the emptied stage',
  ].join(', '),
  () => {
    // given
    const lifecycle = lifecycleConfigSchema.parse({
      name: 'delivery',
      stages: [
        { name: 'load', activities: ['import'] },
        { name: 'build', activities: ['build'] },
      ],
    })
    // when
    const actual = withoutImport(lifecycle.stages)
    // then
    expect(actual.map((stage) => stage.name)).toEqual(['build'])
    expect(isImportName(IMPORT_NAME)).toBe(true)
    expect(isImportName('build')).toBe(false)
    expect(importIn(actual)).toBe(false)
    expect(
      lifecycleFaults(
        lifecycleConfigSchema.parse({
          name: 'late',
          stages: [
            { name: 'build', activities: ['build'] },
            { name: 'late', activities: ['import'] },
          ],
        }),
      )[0]?.message,
    ).toContain("stage 'late'")
  },
)

for (const [value, valid] of [
  ['import,build', true],
  ['build,import', false],
  ['import+build', false],
] as const) {
  test(
    [
      'given command-line engine steps',
      `when parsing ${value}`,
      'it should share Lifecycle placement rules',
    ].join(', '),
    () => {
      // given
      // when
      // then
      if (valid)
        expect(parseActivities(value, [activity])[0]?.activities).toEqual([
          'import',
          'build',
        ])
      else expect(() => parseActivities(value, [activity])).toThrow("'import'")
    },
  )
}

test(
  [
    'given a registry attempting to define import',
    'when validating names and aliases',
    'it should refuse both with their fixed messages',
  ].join(', '),
  () => {
    // given
    const named = { ...activity, name: 'import' }
    const aliased = { ...activity, aliases: ['import'] }
    // when
    const names = registryFaults([named])
    const aliases = registryFaults([aliased])
    // then
    expect(names).toContain(
      "activity 'import': that name is the engine's import step, not an Activity — a Lifecycle names it first to import referenced work, and configuration cannot define it",
    )
    expect(aliases).toContain(
      "activity 'build': alias 'import' is the engine's import step — configuration cannot make an Activity answer to it",
    )
    expect(
      unknownActivities(['import'], resolveActivities([activity])),
    ).toEqual([])
    expect(() =>
      runnableActivities(
        ['import'],
        crustConfigSchema.parse({ activities: [activity] }),
      ),
    ).toThrow(
      "'import' is the engine's import step — the engine runs it before the fold. Nothing in the fold resolves it.",
    )
  },
)

test(
  [
    'given inline and substituted prompts',
    'when making workflow arguments',
    'it should preserve only the substituted prompt path',
  ].join(', '),
  () => {
    // given
    const args = { prompt: 'request.md' } as Parameters<typeof workflowArgs>[0]
    // when
    const inline = workflowArgs(args, 'request.md')
    const file = workflowArgs(args, 'file contents')
    // then
    expect(inline.promptPath).toBeUndefined()
    expect(file.promptPath).toBe('request.md')
    expect(file.prompt).toBe('file contents')
  },
)

test(
  [
    'given a code import envelope',
    'when parsing its defaults',
    'it should not require context fields meant for agents',
  ].join(', '),
  () => {
    // given
    // when
    const actual = importOutputSchema.parse({
      status: 'success',
      source: { kind: 'handoff' },
    })
    // then
    expect(actual.source).toEqual({
      kind: 'handoff',
      written: '',
      address: '',
      read_at: '',
      updated_at: '',
      sha256: '',
      head: '',
      differs_from_head: false,
    })
    expect(actual.documents).toEqual([])
    expect(actual.comments).toEqual([])
    expect(actual.unattributed_status).toBe('none')
  },
)
