import { expect, test } from 'bun:test'
import { fail, succeed } from '@typedefs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  DEFAULT_POLL_MS,
  PollIntervalContext,
  pollIntervalFrom,
  pollIntervalOf,
  usePollInterval,
} from './poll-interval'

for (const [value, expected] of [
  [250, 250],
  [undefined, 500],
  [0, 500],
  [-5, 500],
  [2.5, 500],
  ['250', 500],
] as const) {
  test(
    [
      `given @SC19 a successful health response with poll_ms ${String(value)}`,
      'when choosing the browser polling interval',
      `it should use ${expected} milliseconds`,
    ].join(', '),
    () => {
      // given
      const health = succeed({ poll_ms: value })
      // when
      const actual = pollIntervalOf(health)
      // then
      expect(actual).toBe(expected)
      expect(pollIntervalFrom(value)).toBe(expected)
      expect(DEFAULT_POLL_MS).toBe(500)
    },
  )
}

test(
  [
    'given a failed health request',
    'when choosing the polling interval',
    'it should retain the default without throwing',
  ].join(', '),
  () => {
    // given
    const health = fail(new Error('request failed'))
    // when
    const actual = pollIntervalOf(health)
    // then
    expect(actual).toBe(DEFAULT_POLL_MS)
  },
)

const Interval = () =>
  createElement('span', undefined, String(usePollInterval()))

for (const provided of [false, true]) {
  test(
    [
      `given @SC19 a polling context ${provided ? 'with' : 'without'} a provider`,
      'when read through server rendering without a DOM',
      'it should return the configured interval or the default',
    ].join(', '),
    () => {
      // given
      const element = provided
        ? createElement(
            PollIntervalContext.Provider,
            { value: 250 },
            createElement(Interval),
          )
        : createElement(Interval)
      // when
      const actual = renderToStaticMarkup(element)
      // then
      expect(actual).toBe(`<span>${provided ? 250 : 500}</span>`)
    },
  )
}
