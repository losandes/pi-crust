import { expect, test } from 'bun:test'
import { DEFAULT_POLL_MS, pollMsFromEnv } from './poll-interval'

for (const [value, expected] of [
  ['250', 250],
  [undefined, 500],
  ['0', 500],
  ['-5', 500],
  ['2.5', 500],
  ['abc', 500],
  [' 250', 500],
  ['01', 500],
  ['9'.repeat(400), 500],
] as const) {
  test(
    [
      `given @SC19 CRUST_POLL_MS as ${String(value)}`,
      'when the server reads its launch environment',
      `it should use ${expected} milliseconds`,
    ].join(', '),
    () => {
      // given
      const env = { CRUST_POLL_MS: value }
      // when
      const actual = pollMsFromEnv(env)
      // then
      expect(actual).toBe(expected)
      expect(DEFAULT_POLL_MS).toBe(500)
    },
  )
}
