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
