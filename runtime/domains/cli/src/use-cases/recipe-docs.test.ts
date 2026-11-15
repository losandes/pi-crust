import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { USAGE as CATALOGUE_USAGE } from '../../../../catalogue'
import { USAGE as DECIDE_USAGE } from '../../../../decide'
import { USAGE as PRUNE_USAGE } from '../../../../prune'
import { USAGE as REPORT_USAGE } from '../../../../report'
import { FLAG_TABLE } from './parse-cli'
import { GLOBAL_FLAGS, RECIPE_DOCS, recipeDoc } from './recipe-docs'

/*
 * Tests MUST NOT import runtime/steer.ts, runtime/resume.ts or
 * runtime/consult.ts: each ends in `process.exitCode = await main()` with no
 * `import.meta.main` guard, so importing one runs it. Their flag text is
 * transcribed by hand in recipe-docs.ts instead (issue #35, 1.3.5).
 */

/** Recipe names, which are the lines that start in column one and end in `:`. */
const recipeNamesInCrustJust = (): readonly string[] =>
  readFileSync(
    join(import.meta.dir, '..', '..', '..', '..', 'crust.just'),
    'utf8',
  )
    .split('\n')
    .flatMap((line) => {
      const match = line.match(/^([a-z][\w-]*)(\s+[^:]*)?:\s*$/)

      return match?.[1] === undefined ? [] : [match[1]]
    })

const documentedNames = (): readonly string[] =>
  RECIPE_DOCS.map((doc) => doc.name)

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
    'given recipe-docs::RECIPE_DOCS',
    'when compared against the recipes crust.just declares',
    'it should document exactly the same set, in both directions',
  ].join(', '),
  () => {
    // given
    const declared = recipeNamesInCrustJust()

    // when
    const documented = documentedNames()

    // then
    expect(declared.length).toBeGreaterThan(0)
    expect(documented.toSorted()).toEqual(
      [...new Set([...declared, 'help'])].toSorted(),
    )
  },
)

test(
  [
    'given recipe-docs::RECIPE_DOCS',
    'when every entry is read',
    'it should begin each usage line with "just crust <name>"',
  ].join(', '),
  () => {
    for (const doc of RECIPE_DOCS) {
      // given
      // when
      const actual = doc.usage.startsWith(`just crust ${doc.name}`)

      // then
      expect(actual).toBe(true)
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
      'just crust run "..." --lifecycle deliver -m build=openai/gpt-5@high,code-review=@xhigh',
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

const usageCases = [
  { script: 'catalogue.ts', usage: CATALOGUE_USAGE, recipes: ['list'] },
  {
    script: 'report.ts',
    usage: REPORT_USAGE,
    recipes: ['report', 'report-json'],
  },
  { script: 'prune.ts', usage: PRUNE_USAGE, recipes: ['prune'] },
  {
    script: 'decide.ts',
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
