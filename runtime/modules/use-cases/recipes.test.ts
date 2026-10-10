import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isStepName } from '../typedefs/step'

/**
 * The recipes and the step registry have to agree, and nothing else makes
 * them.
 *
 * An Activity used to be a file, so a recipe naming one that did not exist
 * failed at the shell with a missing path. Now a recipe names a step in a
 * flag, and a stale name reaches the runner as a usage error at the moment
 * somebody runs it — which is late, and only for the one recipe they tried.
 */
const recipes = () =>
  readFileSync(
    join(import.meta.dir, '..', '..', 'crust.just'),
    'utf8',
  ).split('\n')

const stepFlags = (lines: readonly string[]): readonly string[] =>
  lines.flatMap((line) => {
    const match = line.match(/--steps ([a-z-]+)\s*$/)

    return match?.[1] === undefined ? [] : [match[1]]
  })

test(
  [
    'given use-cases/recipes',
    'when the justfile names a step',
    'it should be a step the registry has',
  ].join(', '),
  () => {
    // given
    const given = stepFlags(recipes())

    // when
    const actual = given.filter((name) => !isStepName(name))

    // then
    expect(given.length).toBeGreaterThan(0)
    expect(actual).toEqual([])
  },
)

test(
  [
    'given use-cases/recipes',
    'when a recipe runs one Activity',
    'it should route through the composer rather than a file of its own',
  ].join(', '),
  () => {
    // given — the 21 single-Activity files are gone; two Planners remain
    const given = recipes()

    // when
    const actual = given
      .filter((line) => line.includes('.pi-crust/stages/'))
      .map((line) => line.trim())

    // then
    expect(actual.every((line) => /(triage|operator)\.ts/.test(line))).toBe(
      true,
    )
  },
)

test(
  [
    'given use-cases/recipes',
    'when a recipe passes its own step after the caller arguments',
    'it should win, so the recipe always means what its name says',
  ].join(', '),
  () => {
    // given — `just crust build --steps plan` must still run build
    const given = recipes().filter((line) => line.includes('--steps'))

    // when
    const actual = given.filter(
      (line) => line.includes('"$@"') && !/"\$@".*--steps/.test(line),
    )

    // then
    expect(actual).toEqual([])
  },
)
