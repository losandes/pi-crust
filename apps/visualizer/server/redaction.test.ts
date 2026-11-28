import { expect, test } from 'bun:test'
import { homeDirFromEnv, redactPathsFromEnv } from './redaction'

for (const value of [
  undefined,
  '',
  'FALSE',
  ' false',
  '0',
  'no',
  'off',
  'true',
  '1',
  'false',
]) {
  test(
    [
      `given CRUST_REDACT_PATHS=${String(value)}`,
      'when reading the setting',
      'it should disable only for exact false',
    ].join(', '),
    () => {
      // given
      // when
      const enabled = redactPathsFromEnv({ CRUST_REDACT_PATHS: value })
      // then
      expect(enabled).toBe(value !== 'false')
    },
  )
}

for (const home of [undefined, '', '   ', '/Users/ada']) {
  test(
    [
      `given HOME=${String(home)}`,
      'when finding the home directory',
      'it should prefer a nonblank environment value',
    ].join(', '),
    () => {
      // given
      // when
      const actual = homeDirFromEnv({ HOME: home }, () => '/os/home')
      // then
      expect(actual).toBe(home?.trim() ? home : '/os/home')
    },
  )
}

test(
  [
    'given the process environment',
    'when reading default settings',
    'it should use the current environment',
  ].join(', '),
  () => {
    // given
    // when
    const enabled = redactPathsFromEnv()
    const home = homeDirFromEnv()
    // then
    expect(enabled).toBe(process.env.CRUST_REDACT_PATHS !== 'false')
    expect(home).toBeTruthy()
  },
)
