import { expect, test } from 'bun:test'
import { canLaunch, integrationEnabled } from './integration'

for (const { name, env, expected } of [
  {
    name: 'the exact true string',
    env: { RUN_INTEGRATION_TESTS: 'true' },
    expected: true,
  },
  { name: 'an unset variable', env: {}, expected: false },
  ...['', '1', 'TRUE', 'false'].map((value) => ({
    name: `the value ${JSON.stringify(value)}`,
    env: { RUN_INTEGRATION_TESTS: value },
    expected: false,
  })),
]) {
  test(
    [
      `given integrationEnabled and ${name}`,
      'when integration opt-in is evaluated',
      `it should return ${expected}`,
    ].join(', '),
    () => {
      // given
      const environment = env

      // when
      const actual = integrationEnabled(environment)

      // then
      expect(actual).toBe(expected)
    },
  )
}

test(
  [
    'given a launchable browser',
    'when availability is probed',
    'it should close the browser before returning true',
  ].join(', '),
  async () => {
    // given
    let closed = false
    const launch = () =>
      Promise.resolve({
        close: () => {
          closed = true
          return Promise.resolve()
        },
      })

    // when
    const actual = await canLaunch(launch)()

    // then
    expect(actual).toBe(true)
    expect(closed).toBe(true)
  },
)

test(
  [
    'given an unavailable browser launcher',
    'when availability is probed',
    'it should return false rather than reject',
  ].join(', '),
  async () => {
    // given
    const launch = () => Promise.reject(new Error('Chromium is unavailable'))

    // when
    const actual = await canLaunch(launch)()

    // then
    expect(actual).toBe(false)
  },
)
