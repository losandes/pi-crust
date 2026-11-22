import { expect, test } from 'bun:test'
import { crustConfigSchema } from '../../../../lib/contracts'
import { matchingChecks, matchingPaths } from './route-by-path'

const configWith = (
  routing: Readonly<Record<string, unknown>>,
): ReturnType<typeof crustConfigSchema.parse> =>
  crustConfigSchema.parse({ routing, agents: [] })

test(
  [
    'given use-cases/route-by-path::matchingPaths',
    'when a rule uses a single-star glob',
    'it should match only the root, because * does not cross a separator',
  ].join(', '),
  () => {
    // given
    const paths = ['server.ts', 'src/server.ts']

    // when
    const actual = matchingPaths(paths, ['*.ts'])

    // then
    expect(actual).toEqual(['server.ts'])
  },
)

test(
  [
    'given use-cases/route-by-path::matchingPaths',
    'when a rule uses a double-star glob',
    'it should reach a nested file',
  ].join(', '),
  () => {
    // given
    const paths = ['server.ts', 'src/deep/server.ts']

    // when
    const actual = matchingPaths(paths, ['**/*.ts'])

    // then
    expect(actual).toEqual(['src/deep/server.ts'])
  },
)

test(
  [
    'given use-cases/route-by-path::matchingChecks',
    'when a check asks for the changed paths',
    'it should append only the paths that rule selected',
  ].join(', '),
  () => {
    // given
    const cfg = configWith({
      checks: [
        {
          name: 'lint',
          when: ['**/*.ts'],
          argv: ['biome', 'lint'],
          with_changed_paths: true,
        },
      ],
    })

    // when
    const actual = matchingChecks(cfg, ['src/a.ts', 'docs/b.md'])

    // then
    expect(actual).toEqual([
      {
        name: 'lint',
        argv: ['biome', 'lint', 'src/a.ts'],
        timeoutSeconds: 300,
        cwd: '',
      },
    ])
  },
)

test(
  [
    'given use-cases/route-by-path::matchingChecks',
    'when the config declares no routing at all',
    'it should return an empty list rather than throw',
  ].join(', '),
  () => {
    // given
    const cfg = crustConfigSchema.parse({ agents: [] })

    // when
    const actual = matchingChecks(cfg, ['src/a.ts'])

    // then
    expect(actual).toEqual([])
  },
)

test(
  [
    'given use-cases/route-by-path::checkSpec',
    'when a check runs in a subdirectory of the git root',
    'it should rebase the changed paths onto that directory',
  ].join(', '),
  () => {
    // given paths are collected from the git root; the command is not run there
    const cfg = crustConfigSchema.parse({
      routing: {
        checks: [
          {
            name: 'lint',
            when: ['pkg/**/*.ts'],
            cwd: 'pkg',
            argv: ['biome', 'lint'],
            with_changed_paths: true,
          },
        ],
      },
      agents: [],
    })

    // when
    const actual = matchingChecks(cfg, ['pkg/src/a.ts', 'other/b.ts'])

    // then
    expect(actual[0]?.argv).toEqual(['biome', 'lint', 'src/a.ts'])
    expect(actual[0]?.cwd).toEqual('pkg')
  },
)
