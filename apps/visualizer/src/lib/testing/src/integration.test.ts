import { expect, mock, test } from 'bun:test'
import {
  hasExecutable,
  integrationEnabled,
  openSuiteWith,
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

for (const { name, installed, expected } of [
  { name: 'an installed executable', installed: true, expected: true },
  { name: 'a missing executable', installed: false, expected: false },
]) {
  test(
    [
      `given hasExecutable and ${name}`,
      'when availability is checked',
      `it should return ${expected} for the resolved path`,
    ].join(', '),
    () => {
      // given
      const exists = mock((path: string) => installed && path === '/chromium')

      // when
      const actual = hasExecutable(exists)(() => '/chromium')

      // then
      expect(actual).toBe(expected)
      expect(exists.mock.calls).toEqual([['/chromium']])
    },
  )
}

test(
  [
    'given hasExecutable and a path that cannot be resolved',
    'when availability is checked',
    'it should return false rather than throw',
  ].join(', '),
  () => {
    // given
    const exists = mock(() => true)
    const executablePath = (): string => {
      throw new Error('no browser registry')
    }

    // when
    const actual = hasExecutable(exists)(executablePath)

    // then
    expect(actual).toBe(false)
    expect(exists).not.toHaveBeenCalled()
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

test(
  [
    'given openSuiteWith and a browser and server that both start',
    'when the suite is opened',
    'it should return both with the server base and close neither',
  ].join(', '),
  async () => {
    // given
    const browser = { close: mock(() => Promise.resolve()) }
    const server = { close: mock(() => Promise.resolve()) }
    const open = openSuiteWith({
      launch: () => Promise.resolve(browser),
      start: () => Promise.resolve({ server, base: 'http://127.0.0.1:1' }),
    })

    // when
    const actual = await open()

    // then
    expect(actual).toEqual({ browser, server, base: 'http://127.0.0.1:1' })
    expect(browser.close).not.toHaveBeenCalled()
    expect(server.close).not.toHaveBeenCalled()
  },
)

test(
  [
    'given openSuiteWith and a server that cannot start',
    'when the suite is opened',
    'it should close the browser it already started and reject with the server failure',
  ].join(', '),
  async () => {
    // given
    const browser = { close: mock(() => Promise.resolve()) }
    const failure = new Error('port unavailable')
    const open = openSuiteWith({
      launch: () => Promise.resolve(browser),
      start: () => Promise.reject(failure),
    })

    // when
    const actual = open()

    // then
    await expect(actual).rejects.toBe(failure)
    expect(browser.close).toHaveBeenCalledTimes(1)
  },
)
