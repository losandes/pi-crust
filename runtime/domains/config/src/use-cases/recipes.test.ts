import { expect, test } from 'bun:test'
import { shippedConfig } from '../../../../testing/shipped-layer'
import { RECIPE_DOCS } from '../../../cli'

const shippedActivities = (): readonly string[] =>
  shippedConfig().activities.map((one) => one.name)
const shippedLifecycles = (): readonly string[] =>
  shippedConfig().lifecycles.map((one) => one.name)

const recipeNames = (): readonly string[] => RECIPE_DOCS.map((doc) => doc.name)

test(
  [
    'given use-cases/recipes',
    'when the recipes are read',
    'it should reserve Activity names for pinned lifecycle commands',
  ].join(', '),
  () => {
    // given
    const given = RECIPE_DOCS.filter((doc) => doc.run.lifecycle === undefined)

    // when
    const actual = given.filter((doc) => shippedActivities().includes(doc.name))

    // then
    expect(given.length).toBeGreaterThan(0)
    expect(actual).toEqual([])
  },
)

test(
  [
    'given use-cases/recipes',
    'when the recipes are read',
    'it should pin exactly the named shipped lifecycles and reserve every other name',
  ].join(', '),
  () => {
    // given
    const given = RECIPE_DOCS

    // when
    const pinned = given.filter((doc) => doc.run.lifecycle !== undefined)
    const unpinned = given.filter((doc) => doc.run.lifecycle === undefined)

    // then
    expect(
      unpinned.filter((doc) => shippedLifecycles().includes(doc.name)),
    ).toEqual([])
    expect(pinned.map((doc) => doc.name).toSorted()).toEqual([
      'gh-issue',
      'ship',
      'ship-outcome',
      'ship-plan',
    ])
    for (const doc of pinned) {
      expect(doc.run.lifecycle).toBe(doc.name)
      expect(doc.run.script).toBe('runtime/commands/run.ts')
      expect(shippedLifecycles()).toContain(doc.run.lifecycle)
    }
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
