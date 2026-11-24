import { expect, test } from 'bun:test'
import { planDispatch } from './plan-dispatch'
import { RECIPE_DOCS } from './recipe-docs'
import {
  crustArgv,
  dispatchArgv,
  RUN_RECIPE,
  recipeArgv,
  recipeOf,
  shellLine,
} from './recipe-line'
import { resumeArgv } from './resume-run'

test(
  [
    'given a command and arguments with spaces',
    'when composed and prepared for dispatch',
    'it should preserve every argument boundary',
  ].join(', '),
  () => {
    // given
    const args = ['a b', '--stream']
    // when
    const argv = crustArgv('run', args)
    // then
    expect(argv).toEqual(['crust', 'run', 'a b', '--stream'])
    expect(dispatchArgv(argv)).toEqual(['run', 'a b', '--stream'])
  },
)

for (const name of ['run', 'operator', 'triage']) {
  test(
    [
      `given a recorded ${name} invocation`,
      'when resumed through the printed command',
      'it should dispatch the same program and prompt under the same run id',
    ].join(', '),
    () => {
      // given
      const invocation = [
        'bun',
        `/pkg/runtime/commands/${name}.ts`,
        'fix the login bug',
      ]
      // when
      const argv =
        recipeArgv(['bun', ...resumeArgv(invocation, 'a1b2c3d4')]) ?? []
      const actual = planDispatch(RECIPE_DOCS)({
        argv: dispatchArgv(argv),
        packageRoot: '/pkg',
        cwd: '/repo',
        repositoryRoot: '/repo',
        env: {},
      })
      // then
      expect(argv.slice(0, 2)).toEqual(['crust', name])
      expect(actual.status).toBe('ok')
      if (actual.status === 'ok') {
        expect(actual.data.script).toBe(`/pkg/runtime/commands/${name}.ts`)
        expect(actual.data.args).toContain('fix the login bug')
        expect(actual.data.args.slice(-3)).toEqual([
          '--run-id',
          'a1b2c3d4',
          '--resume',
        ])
      }
    },
  )
}

test(
  [
    'given use-cases/recipe-line::recipeOf',
    'when the entry point is the Composer',
    'it should be the run recipe, which is the only route to a chain',
  ].join(', '),
  () => {
    // given
    const script = '/Users/andy/src/pi-crust/runtime/commands/run.ts'

    // when
    const actual = recipeOf(script)

    // then
    expect(actual).toBe(RUN_RECIPE)
  },
)

test(
  [
    'given use-cases/recipe-line::recipeArgv',
    'when a recorded invocation names an absolute entry point',
    'it should become the recipe, carrying every flag it was given',
  ].join(', '),
  () => {
    // given — argv as a run records it: absolute, because that is what ran
    const argv = [
      'bun',
      '/Users/andy/src/pi-crust/runtime/commands/run.ts',
      'add a /health endpoint',
      '--lifecycle',
      'sdlc',
      '--approve-after',
      'plan',
    ]

    // when
    const actual = recipeArgv(argv)

    // then
    expect(actual).toEqual([
      'crust',
      'run',
      'add a /health endpoint',
      '--lifecycle',
      'sdlc',
      '--approve-after',
      'plan',
    ])
  },
)

test(
  [
    'given use-cases/recipe-line::recipeArgv',
    'when a Planner is what ran',
    'it should be that Planner recipe, which takes the same arguments',
  ].join(', '),
  () => {
    // given
    const argv = [
      'bun',
      '/pkg/runtime/commands/operator.ts',
      'the webhook drops retries',
    ]

    // when
    const actual = recipeArgv(argv)

    // then
    expect(actual).toEqual(['crust', 'operator', 'the webhook drops retries'])
  },
)

test(
  [
    'given use-cases/recipe-line::recipeArgv',
    'when no recipe runs the entry point',
    'it should be undefined rather than an invented recipe name',
  ].join(', '),
  () => {
    // given — a command that does not exist is worse than a long one that does
    const argv = ['bun', '/pkg/runtime/some-new-entry.ts', 'x']

    // when
    const actual = recipeArgv(argv)

    // then
    expect(actual).toBeUndefined()
  },
)

test(
  [
    'given use-cases/recipe-line::shellLine',
    'when an argument contains spaces',
    'it should quote only that one, so the quoting itself carries meaning',
  ].join(', '),
  () => {
    // given
    const argv = ['crust', 'run', 'add a /health endpoint']

    // when
    const actual = shellLine(argv)

    // then
    expect(actual).toBe('crust run "add a /health endpoint"')
  },
)

test(
  [
    'given use-cases/recipe-line::shellLine',
    'when a chain names a concurrent Stage',
    'it should leave the + unquoted, because a quote there reads as meaning',
  ].join(', '),
  () => {
    // given
    const argv = ['crust', 'run', 'x', '--activities', 'review+code-review']

    // when
    const actual = shellLine(argv)

    // then
    expect(actual).toContain('--activities review+code-review')
  },
)
