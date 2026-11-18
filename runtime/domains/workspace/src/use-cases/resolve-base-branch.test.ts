import { expect, test } from 'bun:test'
import type { TBaseBranch, TBaseBranchSource } from '../../../../lib/contracts'
import {
  crustConfigSchema,
  terminalConfigSchema,
} from '../../../../lib/contracts'
import {
  baseBranchFrom,
  baseBranchProvenance,
  configuredBase,
  resolveBaseBranchWith,
} from './resolve-base-branch'

for (const entry of [
  {
    flag: 'hotfix',
    configured: 'release',
    remoteDefault: 'dev',
    name: 'hotfix',
    source: 'flag',
  },
  {
    flag: '',
    configured: 'release',
    remoteDefault: 'dev',
    name: 'release',
    source: 'configuration',
  },
  {
    flag: '',
    configured: undefined,
    remoteDefault: 'dev',
    name: 'dev',
    source: 'remote-default',
  },
  {
    flag: '',
    configured: '',
    remoteDefault: 'dev',
    name: 'dev',
    source: 'remote-default',
  },
  {
    flag: '',
    configured: undefined,
    remoteDefault: '',
    name: 'main',
    source: 'built-in',
  },
  {
    flag: '',
    configured: '',
    remoteDefault: '',
    name: 'main',
    source: 'built-in',
  },
] as const) {
  test(
    [
      `given base candidates ${JSON.stringify(entry)}`,
      'when choosing a base branch',
      `it should choose ${entry.name} from ${entry.source}`,
    ].join(', '),
    () => {
      // given
      const candidates = { ...entry, remote: 'up/stream' }
      // when
      const actual = baseBranchFrom(candidates)
      // then
      expect(actual).toEqual({
        name: entry.name,
        source: entry.source,
        remote: 'up/stream',
      })
    },
  )
}

for (const [source, expected] of [
  ['flag', 'named by the --scope flag'],
  ['configuration', 'named by delivery.base in configuration'],
  ['remote-default', "the default branch remote 'up/stream' declares"],
  [
    'built-in',
    "the built-in fallback: nothing named a base branch and remote 'up/stream' declares no default",
  ],
] satisfies readonly (readonly [TBaseBranchSource, string])[]) {
  test(
    [
      `given a base from ${source}`,
      'when describing its provenance',
      'it should name the tier and the consulted remote where applicable',
    ].join(', '),
    () => {
      // given
      const base: TBaseBranch = {
        name: 'release/1.x',
        source,
        remote: 'up/stream',
      }
      // when
      const actual = baseBranchProvenance(base)
      // then
      expect(actual).toBe(expected)
    },
  )
}

test(
  [
    'given a pull request entry without an explicit delivery base',
    'when reading configuration with or without a delivery block',
    'it should preserve absence rather than manufacture a configured branch',
  ].join(', '),
  () => {
    // given
    const raw = {
      name: 'gh-pull-request',
      purpose: 'Deliver the change',
      prompt_engineering: { system: 's.md', user: 'u.md' },
    }
    // when
    const omitted = terminalConfigSchema.parse(raw)
    const explicit = terminalConfigSchema.parse({
      ...raw,
      delivery: { remote: 'up/stream' },
    })
    // then
    expect(configuredBase({ terminal: [omitted] })).toEqual({
      configured: undefined,
      remote: 'origin',
    })
    expect(configuredBase({ terminal: [explicit] })).toEqual({
      configured: undefined,
      remote: 'up/stream',
    })
  },
)

for (const present of [false, true]) {
  test(
    [
      `given configuration ${present ? 'with' : 'without'} a pull request entry`,
      'when resolving its configured base and remote',
      'it should use only that entry and pass the remote to git',
    ].join(', '),
    () => {
      // given
      const terminal = terminalConfigSchema.parse({
        name: 'gh-pull-request',
        purpose: 'Deliver the change',
        prompt_engineering: { system: 's.md', user: 'u.md' },
        delivery: { base: 'release', remote: 'up/stream' },
      })
      const cfg = crustConfigSchema.parse({
        terminal: present ? [terminal] : [],
      })
      const consulted: string[] = []
      const resolve = resolveBaseBranchWith({
        remoteDefaultBranch: (remote) => {
          // biome-ignore lint/plugin/no-array-mutation: recording the injected git boundary is the test
          consulted.push(remote)
          return 'dev'
        },
      })
      // when
      const configured = configuredBase(cfg)
      const actual = resolve(cfg, '')
      // then
      expect(configured).toEqual({
        configured: present ? 'release' : undefined,
        remote: present ? 'up/stream' : 'origin',
      })
      expect(consulted).toEqual([present ? 'up/stream' : 'origin'])
      expect(actual.name).toBe(present ? 'release' : 'dev')
      expect(actual.source).toBe(present ? 'configuration' : 'remote-default')
    },
  )
}
