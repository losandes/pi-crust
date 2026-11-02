import { afterAll, afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { engineerName } from './engineer'

afterAll(() => {
  // mock.module() leaks across files in bun's shared module registry
  // (https://bun.sh/docs/test/parallel); restore the real module explicitly
  // rather than rely on mock.restore(), which does not undo it.
  mock.module('node:child_process', () => require('node:child_process'))
})

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

/** Same reasoning as `setEngineerName`: the adapter for the other env var this file fakes. */
const setUser = (value: string | undefined): void => {
  if (value === undefined) {
    delete process.env.USER
    return
  }
  // biome-ignore lint/plugin/no-object-mutation: process.env is the external API engineerName reads, and this function is the adapter that owns the assignment
  process.env.USER = value
}

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

test(
  [
    'given data/engineer::engineerName',
    'when ENGINEER_NAME is unset and git has a configured user.name',
    'it should use what git reports',
  ].join(', '),
  () => {
    // given
    mock.module('node:child_process', () => ({
      ...require('node:child_process'),
      spawnSync: () => ({ status: 0, stdout: 'git user\n' }),
    }))

    // when
    const actual = engineerName()

    // then
    expect(actual).toEqual('git user')
    mock.module('node:child_process', () => require('node:child_process'))
  },
)

test(
  [
    'given data/engineer::engineerName',
    'when ENGINEER_NAME is unset and git has no configured user.name',
    'it should fall back to $USER, or the literal "engineer"',
  ].join(', '),
  () => {
    // given
    const originalUser = process.env.USER
    mock.module('node:child_process', () => ({
      ...require('node:child_process'),
      spawnSync: () => ({ status: 1, stdout: '' }),
    }))

    // when
    setUser(undefined)
    const withoutUser = engineerName()
    setUser('someone')
    const withUser = engineerName()

    // then
    expect(withoutUser).toEqual('engineer')
    expect(withUser).toEqual('someone')

    setUser(originalUser)
    mock.module('node:child_process', () => require('node:child_process'))
  },
)
