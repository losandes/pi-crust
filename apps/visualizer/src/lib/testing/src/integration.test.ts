import { expect, mock, test } from 'bun:test'
import {
  canLaunch,
  integrationEnabled,
  reportUnavailableBrowser,
} from './integration'

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
    const close = mock(() => Promise.resolve())
    const launch = () => Promise.resolve({ close })

    // when
    const actual = await canLaunch(launch)()

    // then
    expect(actual).toBe(true)
    expect(close).toHaveBeenCalledTimes(1)
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

for (const { enabled, available, expected } of [
  { enabled: false, available: false, expected: [] },
  { enabled: false, available: true, expected: [] },
  { enabled: true, available: true, expected: [] },
  {
    enabled: true,
    available: false,
    expected: [
      'No Chromium — skipping browser tests. Run `bunx playwright install chromium` from apps/visualizer.',
    ],
  },
]) {
  test(
    [
      `given integration enabled=${enabled} and browser available=${available}`,
      'when browser availability is reported',
      expected.length > 0
        ? 'it should emit the Chromium installation diagnostic'
        : 'it should emit no diagnostic',
    ].join(', '),
    () => {
      // given
      const warn = mock((message: string) => message)

      // when
      reportUnavailableBrowser(warn)(enabled, available)

      // then
      expect(warn.mock.calls.map(([message]) => message)).toEqual(expected)
    },
  )
}
