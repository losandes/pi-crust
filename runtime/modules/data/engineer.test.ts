import { afterEach, beforeEach, expect, test } from 'bun:test'
import { engineerName } from './engineer'

const originalEngineerName = process.env.ENGINEER_NAME

/**
 * `process.env` is the external API `engineerName` reads, and pointing it at
 * a fixture is the only way to exercise it. Assigning to it is the adapter,
 * said once here rather than at every call site.
 */
const setEngineerName = (value: string | undefined): void => {
  if (value === undefined) {
    delete process.env.ENGINEER_NAME
    return
  }
  // biome-ignore lint/plugin/no-object-mutation: process.env is the external API engineerName reads, and this function is the adapter that owns the assignment
  process.env.ENGINEER_NAME = value
}

beforeEach(() => {
  setEngineerName(undefined)
})

afterEach(() => {
  setEngineerName(originalEngineerName)
})

test(
  [
    'given data/engineer::engineerName',
    'when ENGINEER_NAME is set in the environment',
    'it should use it rather than asking git',
  ].join(', '),
  () => {
    // given
    setEngineerName('quality lane')

    // when
    const actual = engineerName()

    // then
    expect(actual).toEqual('quality lane')
  },
)

test(
  [
    'given data/engineer::engineerName',
    'when ENGINEER_NAME is unset',
    'it should fall back to git or $USER, and never return empty',
  ].join(', '),
  () => {
    // given, when
    const actual = engineerName()

    // then
    expect(actual.length).toBeGreaterThan(0)
  },
)
