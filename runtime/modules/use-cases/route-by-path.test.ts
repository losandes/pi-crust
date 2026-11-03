import { expect, test } from 'bun:test'
import { crustConfigSchema } from '../typedefs/config'
import {
  baseActivityRunName,
  matchingChecks,
  matchingPaths,
  matchingSkills,
} from './route-by-path'

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
    'given use-cases/route-by-path::matchingSkills',
    'when a skill names the agents that receive it',
    'it should reach only those agents',
  ].join(', '),
  () => {
    // given
    const cfg = configWith({
      skills: [
        {
          name: 'code-review',
          path: 'skills/code-review',
          agents: ['code-reviewer'],
          when: ['**/*.ts'],
        },
      ],
    })

    // when
    const reviewer = matchingSkills(cfg, 'code-reviewer', ['src/a.ts'])
    const builder = matchingSkills(cfg, 'builder', ['src/a.ts'])

    // then
    expect(reviewer).toEqual(['skills/code-review'])
    expect(builder).toEqual([])
  },
)

test(
  [
    'given use-cases/route-by-path::matchingSkills',
    'when no changed path matches the rule',
    'it should load nothing',
  ].join(', '),
  () => {
    // given
    const cfg = configWith({
      skills: [{ name: 'review', path: 'skills/x', when: ['**/*.ts'] }],
    })

    // when
    const actual = matchingSkills(cfg, 'code-reviewer', ['README.md'])

    // then
    expect(actual).toEqual([])
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
          operation: 'lint',
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
        area: 'backend',
        operation: 'lint',
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
            operation: 'lint',
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

test(
  [
    'given use-cases/route-by-path::matchingSkills',
    'when a skill names the activities that receive it',
    'it should reach those activities and their numbered repeats, and no other',
  ].join(', '),
  () => {
    // given
    const cfg = configWith({
      skills: [
        {
          name: 'answer-a-review',
          path: 'skills/answer-a-review',
          agents: ['builder'],
          activity_runs: ['revise'],
        },
      ],
    })

    // when
    const onRevise = matchingSkills(cfg, 'builder', ['src/a.ts'], 'revise')
    const onSecondRevise = matchingSkills(
      cfg,
      'builder',
      ['src/a.ts'],
      'revise_2',
    )
    const onBuild = matchingSkills(cfg, 'builder', ['src/a.ts'], 'build')

    // then
    expect(onRevise).toEqual(['skills/answer-a-review'])
    expect(onSecondRevise).toEqual(['skills/answer-a-review'])
    expect(onBuild).toEqual([])
  },
)

test(
  [
    'given use-cases/route-by-path::matchingSkills',
    'when a skill declares no activity-run',
    'it should reach every activity run, including a call that names none',
  ].join(', '),
  () => {
    // given
    const cfg = configWith({
      skills: [{ name: 'code-review', path: 'skills/code-review' }],
    })

    // when
    const actual = [
      matchingSkills(cfg, 'code-reviewer', ['src/a.ts'], 'code-review'),
      matchingSkills(cfg, 'code-reviewer', ['src/a.ts']),
    ]

    // then
    expect(actual).toEqual([['skills/code-review'], ['skills/code-review']])
  },
)

test(
  [
    'given use-cases/route-by-path::baseActivityRunName',
    'when an activity run carries an instance suffix',
    'it should strip the numbering, because a repeat is not a different activity-run',
  ].join(', '),
  () => {
    // given
    const names = ['revise', 'revise_2', 'code-review_3', 'build']

    // when
    const actual = names.map(baseActivityRunName)

    // then
    expect(actual).toEqual(['revise', 'revise', 'code-review', 'build'])
  },
)
