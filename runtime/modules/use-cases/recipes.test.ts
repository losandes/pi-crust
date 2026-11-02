import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { activitiesFileSchema } from '../typedefs/activity'
import { lifecyclesFileSchema } from '../typedefs/lifecycle'

/**
 * No recipe is named for an Activity or a Lifecycle, and nothing else checks.
 *
 * This is the inverse of the check it replaces. That one read every
 * `--steps <name>` out of `crust.just` and asserted the name was real, which
 * is the wrong direction: a capability with no recipe is invisible to a check
 * that starts from the recipes, and four Lifecycles were added with no route
 * while it stayed green. Its second assertion was worse — it filtered the
 * file for `.pi-crust/stages/`, a string the recipes had not contained since
 * the runtime left the stamp, so it asserted an empty list was empty and
 * would have passed against any file at all.
 *
 * Checked against the SHIPPED configuration, which is what a stamp installs.
 */
const shipped = <T>(file: string, read: (text: string) => T): T =>
  read(
    readFileSync(
      join(
        import.meta.dir,
        '..',
        '..',
        '..',
        'templates',
        'stamp',
        'config',
        file,
      ),
      'utf8',
    ),
  )

const shippedActivities = (): readonly string[] =>
  shipped('crust.activities.yaml', (text) =>
    activitiesFileSchema
      .parse(Bun.YAML.parse(text))
      .activities.map((one) => one.name),
  )

const shippedLifecycles = (): readonly string[] =>
  shipped('crust.lifecycles.yaml', (text) =>
    lifecyclesFileSchema
      .parse(Bun.YAML.parse(text))
      .lifecycles.map((one) => one.name),
  )

/** Recipe names, which are the lines that start in column one and end in `:`. */
const recipeNames = (): readonly string[] =>
  readFileSync(join(import.meta.dir, '..', '..', 'crust.just'), 'utf8')
    .split('\n')
    .flatMap((line) => {
      const match = line.match(/^([a-z][\w-]*)(\s+[^:]*)?:\s*$/)

      return match?.[1] === undefined ? [] : [match[1]]
    })

test(
  [
    'given use-cases/recipes',
    'when the recipes are read',
    'it should name no Activity, because the registry is the only registry',
  ].join(', '),
  () => {
    // given
    const given = recipeNames()

    // when
    const actual = given.filter((name) => shippedActivities().includes(name))

    // then
    expect(given.length).toBeGreaterThan(0)
    expect(actual).toEqual([])
  },
)

test(
  [
    'given use-cases/recipes',
    'when the recipes are read',
    'it should name no Lifecycle, which is how a new one needs no recipe',
  ].join(', '),
  () => {
    // given
    const given = recipeNames()

    // when
    const actual = given.filter((name) => shippedLifecycles().includes(name))

    // then
    expect(shippedLifecycles().length).toBeGreaterThan(0)
    expect(actual).toEqual([])
  },
)

test(
  [
    'given use-cases/recipes',
    'when a chain is named in a recipe body',
    'it should use --activities, because --steps is refused at parse',
  ].join(', '),
  () => {
    // given — `demo` is the one recipe that names a chain, and it is a fixed
    // first-run script rather than a route to an Activity
    const given = readFileSync(
      join(import.meta.dir, '..', '..', 'crust.just'),
      'utf8',
    )

    // when
    const actual = given.includes('--steps')

    // then
    expect(actual).toBe(false)
    expect(given).toContain('--activities scout')
  },
)

test(
  [
    'given use-cases/recipes',
    'when a developer asks what this repository can run',
    'it should be a recipe, because the recipe list no longer answers it',
  ].join(', '),
  () => {
    // given
    const given = recipeNames()

    // when
    const actual = ['list', 'run'].filter((name) => !given.includes(name))

    // then
    expect(actual).toEqual([])
  },
)
