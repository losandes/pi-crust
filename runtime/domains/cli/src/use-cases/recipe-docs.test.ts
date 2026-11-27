import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { DECIDE_USAGE } from './decide-args'
import { FLAG_TABLE } from './parse-cli'
import { GLOBAL_FLAGS, RECIPE_DOCS, recipeDoc } from './recipe-docs'
import { REPORT_USAGE } from './report-args'
import { LIST_USAGE as CATALOGUE_USAGE, PRUNE_USAGE } from './usage'

/*
 * Tests MUST NOT import runtime/commands/steer.ts, runtime/commands/resume.ts or
 * runtime/commands/ask.ts: each ends in `process.exitCode = await main()` with no
 * `import.meta.main` guard, so importing one runs it. Their flag text is
 * transcribed by hand in recipe-docs.ts instead (issue #35, 1.3.5).
 */

/** Every `--flag` token in a blob of transcribed prose. */
const flagTokensIn = (text: string): readonly string[] =>
  Array.from(new Set(text.match(/--[\w-]+/g) ?? []))

/** Whether `token` appears as a whole word anywhere in `haystack`. */
const mentions = (haystack: string, token: string): boolean =>
  new RegExp(
    `(^|[^\\w-])${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w-])`,
  ).test(haystack)

const haystackOf = (
  docs: readonly { flags: readonly { name: string; detail: string }[] }[],
): string => JSON.stringify([...docs, ...GLOBAL_FLAGS])

test(
  [
    'given command definitions',
    'when resolved',
    'it should name existing programs',
  ].join(', '),
  () => {
    // given
    // when
    const missing = RECIPE_DOCS.filter(
      (doc) =>
        !existsSync(join(import.meta.dir, '../../../../../', doc.run.script)),
    )
    // then
    expect(missing).toEqual([])
  },
)

test(
  [
    'given recipe-docs::RECIPE_DOCS',
    'when every entry is read',
    'it should begin each usage and example with "crust <name>"',
  ].join(', '),
  () => {
    for (const doc of RECIPE_DOCS) {
      // given
      // when
      const prefix = `crust ${doc.name}`

      // then
      expect(doc.usage.startsWith(prefix)).toBe(true)
      for (const example of doc.examples)
        expect(example.startsWith(prefix)).toBe(true)
    }
  },
)

test(
  [
    'given recipe-docs::recipeDoc',
    'when asked for a documented name',
    'it should return that entry',
  ].join(', '),
  () => {
    // given
    // when
    const actual = recipeDoc('run')

    // then
    expect(actual?.name).toBe('run')
  },
)

test(
  [
    'given #112 requirement 1.6.1, the run recipe documentation',
    'when an operator looks up model overrides',
    'it should describe both model and thinking changes as run-only and the flag as non-repeatable',
  ].join(', '),
  () => {
    // given
    const recipe = 'run'

    // when
    const actual = recipeDoc(recipe)

    // then
    expect(actual?.flags).toContainEqual({
      name: '--model <activity>=<model>@<thinking>,... (-m)',
      detail:
        "change an activity's model, thinking level, or both, for this run only; give the flag once",
    })
  },
)

test(
  [
    'given #112 requirement 1.6.2, the run recipe documentation',
    'when an operator looks for a lifecycle model-override example',
    'it should show model-plus-thinking and thinking-only overrides in one short flag',
  ].join(', '),
  () => {
    // given
    const recipe = 'run'

    // when
    const actual = recipeDoc(recipe)

    // then
    expect(actual?.examples).toContain(
      'crust run "..." --lifecycle ship -m build=openai/gpt-6.1-sol@high,code-review=@xhigh',
    )
  },
)

test(
  [
    'given recipe-docs::recipeDoc',
    'when asked for a name nothing documents',
    'it should return undefined',
  ].join(', '),
  () => {
    // given
    // when
    const actual = recipeDoc('no-such-recipe')

    // then
    expect(actual).toBeUndefined()
  },
)

test(
  [
    'given use-cases/parse-cli::FLAG_TABLE',
    'when every flag it names is read',
    'it should be documented on the run entry or in the global flags',
  ].join(', '),
  () => {
    // given
    const run = recipeDoc('run')
    const haystack = haystackOf(run === undefined ? [] : [run])

    // when, then
    for (const flag of FLAG_TABLE) {
      expect(mentions(haystack, flag.long)).toBe(true)
    }
  },
)

test(
  [
    'given observe help',
    'when reading built-package flag restrictions',
    'it should distinguish clone-only and installed behavior',
  ].join(', '),
  () => {
    // given
    // when
    const flags = recipeDoc('observe')?.flags
    // then
    expect(flags).toContainEqual({
      name: '--open',
      detail:
        'open the app in a browser once it is listening; from a clone only',
    })
    expect(flags).toContainEqual({
      name: '--strictPort',
      detail:
        'fail rather than pick a different port; an installed pi-crust always does',
    })
  },
)

for (const name of ['gh-issue', 'ship', 'ship-plan', 'ship-outcome']) {
  test(
    [
      `given the ${name} command`,
      'when its documentation is read',
      'it should describe running the lifecycle with two valid examples',
    ].join(', '),
    () => {
      // given
      // when
      const actual = recipeDoc(name)
      // then
      expect(actual).toBeDefined()
      expect(actual?.group).toBe('running work')
      expect(actual?.usage).toBe(
        `crust ${name} "<prompt or path/to/prompt.md>" [options]`,
      )
      expect(actual?.examples).toHaveLength(2)
    },
  )
}

test(
  [
    'given the command table',
    'when running-work entries are ordered',
    'it should place lifecycle commands between run and operator',
  ].join(', '),
  () => {
    // given
    const names = RECIPE_DOCS.map((doc) => doc.name)
    // when
    const actual = names.slice(
      names.indexOf('run'),
      names.indexOf('operator') + 1,
    )
    // then
    expect(actual).toEqual([
      'run',
      'gh-issue',
      'ship',
      'ship-plan',
      'ship-outcome',
      'operator',
    ])
  },
)

const usageCases = [
  { script: 'usage.ts (list)', usage: CATALOGUE_USAGE, recipes: ['list'] },
  {
    script: 'report-args.ts',
    usage: REPORT_USAGE,
    recipes: ['report', 'report-json'],
  },
  { script: 'usage.ts (prune)', usage: PRUNE_USAGE, recipes: ['prune'] },
  {
    script: 'decide-args.ts',
    usage: DECIDE_USAGE,
    recipes: ['approve', 'reject', 'answer'],
  },
]

for (const { script, usage, recipes } of usageCases) {
  test(
    [
      `given ${script}'s exported USAGE`,
      'when every --flag token in it is read',
      'it should be documented on one of the recipes it backs, or globally',
    ].join(', '),
    () => {
      // given
      const docs = recipes.flatMap((name) => {
        const doc = recipeDoc(name)

        return doc === undefined ? [] : [doc]
      })
      const haystack = haystackOf(docs)

      // when, then
      for (const token of flagTokensIn(usage)) {
        expect(mentions(haystack, token)).toBe(true)
      }
    },
  )
}
