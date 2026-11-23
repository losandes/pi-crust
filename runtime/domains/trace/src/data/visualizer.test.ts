import { expect, test } from 'bun:test'
import type { TFetch } from './visualizer'
import {
  backendPort,
  DEFAULT_BE_PORT,
  DEFAULT_FE_PORT,
  frontendPort,
  observeEnv,
  runLink,
  visualizerIsUp,
} from './visualizer'

for (const configured of [false, true]) {
  test(
    [
      `given @SC19 ${configured ? 'configured' : 'default'} observability settings`,
      'when building the trace UI environment',
      'it should forward polling settings, ignore an exported polling value and preserve valid port overrides',
    ].join(', '),
    () => {
      // given
      const observability = configured
        ? {
            db: 'fixture.db',
            poll_ms: 250,
            ports: { backend: 4700, frontend: 4701 },
          }
        : undefined
      // when
      const actual = observeEnv(observability, {
        CRUST_POLL_MS: '999',
        CRUST_BE_PORT: '4800',
        CRUST_FE_PORT: 'invalid',
      })
      const defaults = observeEnv(undefined, {})
      // then
      expect(actual).toEqual({
        CRUST_BE_PORT: '4800',
        CRUST_FE_PORT: configured ? '4701' : '4601',
        CRUST_POLL_MS: configured ? '250' : '500',
      })
      expect(defaults).toEqual({
        CRUST_BE_PORT: '4600',
        CRUST_FE_PORT: '4601',
        CRUST_POLL_MS: '500',
      })
    },
  )
}

const answering =
  (body: unknown, ok = true): TFetch =>
  async () => ({ ok, json: async () => body })

const refusing = (): TFetch => () =>
  Promise.reject(new Error('connection refused'))

test(
  [
    'given data/visualizer::backendPort',
    'when CRUST_BE_PORT names a port',
    'it should use it rather than the default',
  ].join(', '),
  () => {
    // given
    const env = { CRUST_BE_PORT: '5600' }

    // when
    const actual = backendPort(env)

    // then
    expect(actual).toBe(5600)
  },
)

test(
  [
    'given data/visualizer::backendPort',
    'when the variable holds something that is not a port',
    'it should fall back rather than binding to NaN',
  ].join(', '),
  () => {
    // given — an exported variable outlives the terminal it was set in, so it
    // is exactly the thing most likely to hold a stale or wrong value
    const env = { CRUST_BE_PORT: 'yes please' }

    // when
    const actual = backendPort(env)

    // then
    expect(actual).toBe(DEFAULT_BE_PORT)
  },
)

test(
  [
    'given data/visualizer::frontendPort',
    'when nothing is set',
    'it should use the port the UI ships on',
  ].join(', '),
  () => {
    // given
    const env = {}

    // when
    const actual = frontendPort(env)

    // then
    expect(actual).toBe(DEFAULT_FE_PORT)
  },
)

test(
  [
    'given data/visualizer::runLink',
    'when a run is announced',
    'it should link to the hash route the trace view reads',
  ].join(', '),
  () => {
    // given
    const env = { CRUST_FE_PORT: '4700' }

    // when
    const actual = runLink('9afffac5', env)

    // then — hash routing, so no server route has to exist for it
    expect(actual).toBe('http://localhost:4700/#/9afffac5')
  },
)

test(
  [
    'given data/visualizer::visualizerIsUp',
    'when the API answers that it is healthy',
    'it should say so',
  ].join(', '),
  async () => {
    // given
    const fetcher = answering({ ok: true })

    // when
    const actual = await visualizerIsUp({}, fetcher)

    // then
    expect(actual).toBe(true)
  },
)

test(
  [
    'given data/visualizer::visualizerIsUp',
    'when nothing is listening',
    'it should say no instead of failing the run that asked',
  ].join(', '),
  async () => {
    // given — this probe runs at the start of EVERY run
    const fetcher = refusing()

    // when
    const actual = await visualizerIsUp({}, fetcher)

    // then
    expect(actual).toBe(false)
  },
)

test(
  [
    'given data/visualizer::visualizerIsUp',
    'when something else is listening on that port',
    'it should not mistake it for the observability API',
  ].join(', '),
  async () => {
    // given — 4600 is an ordinary port and another dev server may own it
    const fetcher = answering({ service: 'something-else' })

    // when
    const actual = await visualizerIsUp({}, fetcher)

    // then — a link to another app's port is worse than no link
    expect(actual).toBe(false)
  },
)

test(
  [
    'given data/visualizer::backendPort',
    'when TOML configuration names a port and nothing is exported',
    'it should use the committed answer rather than the shipped default',
  ].join(', '),
  () => {
    // given
    const env = {}

    // when
    const actual = backendPort(env, 5600)

    // then
    expect(actual).toBe(5600)
  },
)

test(
  [
    'given data/visualizer::frontendPort',
    'when the variable and the config disagree',
    'it should take the variable, which is the one-off a shell is for',
  ].join(', '),
  () => {
    // given
    const env = { CRUST_FE_PORT: '4701' }

    // when
    const actual = frontendPort(env, 5601)

    // then
    expect(actual).toBe(4701)
  },
)

test(
  [
    'given data/visualizer::runLink',
    'when a repository moved the web app off the default port',
    'it should point the reader at the port the UI is actually on',
  ].join(', '),
  () => {
    // given
    const env = {}

    // when
    const actual = runLink('run_1', env, 5601)

    // then
    expect(actual).toBe('http://localhost:5601/#/run_1')
  },
)
