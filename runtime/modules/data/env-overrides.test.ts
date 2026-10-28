import { expect, test } from 'bun:test'
import { configPathFromEnv, dbPathFromEnv } from './env-overrides'

test(
  [
    'given data/env-overrides::configPathFromEnv',
    'when CRUST_CONFIG names a path',
    'it should return that path',
  ].join(', '),
  () => {
    // given
    const env = { CRUST_CONFIG: 'other/roster.yaml' }

    // when
    const actual = configPathFromEnv(env)

    // then
    expect(actual).toBe('other/roster.yaml')
  },
)

test(
  [
    'given data/env-overrides::configPathFromEnv',
    'when CRUST_CONFIG is absent',
    'it should return undefined so the caller falls through to its default',
  ].join(', '),
  () => {
    // given
    const env = { PATH: '/usr/bin' }

    // when
    const actual = configPathFromEnv(env)

    // then
    expect(actual).toBeUndefined()
  },
)

test(
  [
    'given data/env-overrides::dbPathFromEnv',
    'when CRUST_DB holds only whitespace',
    'it should read as unset rather than as a path of spaces',
  ].join(', '),
  () => {
    // given
    const env = { CRUST_DB: '   ' }

    // when
    const actual = dbPathFromEnv(env)

    // then
    expect(actual).toBeUndefined()
  },
)

test(
  [
    'given data/env-overrides::dbPathFromEnv',
    'when CRUST_DB names a path with surrounding whitespace',
    'it should return the trimmed path',
  ].join(', '),
  () => {
    // given
    const env = { CRUST_DB: '  adws/adw_data/sssf.db \n' }

    // when
    const actual = dbPathFromEnv(env)

    // then
    expect(actual).toBe('adws/adw_data/sssf.db')
  },
)
