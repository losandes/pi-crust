import { expect, test } from 'bun:test'
import {
  axisTicks,
  fmtClock,
  fmtCost,
  fmtDate,
  fmtDuration,
  fmtOffset,
  fmtTokens,
  payloadOk,
  prettyJson,
  ts,
} from './format'

test(
  ['given lib/format::ts', 'when the input is empty', 'it should be NaN'].join(
    ', ',
  ),
  () => {
    // given
    const cases: readonly (string | null | undefined)[] = [null, undefined, '']

    // when
    const actual = cases.map((input) => ts(input))

    // then
    expect(actual.every((value) => Number.isNaN(value))).toBe(true)
  },
)

test(
  [
    'given lib/format::ts',
    'when the input is a real ISO timestamp',
    'it should be the epoch millis it names',
  ].join(', '),
  () => {
    // given
    const iso = '2024-01-01T00:00:00.000Z'

    // when
    const actual = ts(iso)

    // then
    expect(actual).toBe(new Date(iso).getTime())
  },
)

test(
  [
    'given lib/format::fmtDuration',
    'when the value is not a finite non-negative number',
    'it should show the dash placeholder',
  ].join(', '),
  () => {
    // given
    const cases = [Number.NaN, Number.POSITIVE_INFINITY, -5]

    // when
    const actual = cases.map((ms) => fmtDuration(ms))

    // then
    expect(actual).toEqual(['—', '—', '—'])
  },
)

test(
  [
    'given lib/format::fmtDuration',
    'when the duration crosses seconds, minutes and hours',
    'it should pick the coarsest unit that still reads precisely',
  ].join(', '),
  () => {
    // given
    const cases = [
      { ms: 500, expected: '0.50s' },
      { ms: 1500, expected: '1.5s' },
      { ms: 65_000, expected: '1m 05s' },
      { ms: 3_700_000, expected: '1h 01m' },
    ]

    // when
    const actual = cases.map(({ ms }) => fmtDuration(ms))

    // then
    expect(actual).toEqual(cases.map((c) => c.expected))
  },
)

test(
  [
    'given lib/format::fmtClock',
    'when the input does not parse to a finite time',
    'it should show the dash placeholder',
  ].join(', '),
  () => {
    // given
    const iso = undefined

    // when
    const actual = fmtClock(iso)

    // then
    expect(actual).toBe('—')
  },
)

test(
  [
    'given lib/format::fmtClock',
    'when the input is a real timestamp',
    'it should render a 24-hour clock string',
  ].join(', '),
  () => {
    // given
    const iso = '2024-01-01T13:30:00.000Z'

    // when
    const actual = fmtClock(iso)

    // then
    expect(actual).toBe(
      new Date(ts(iso)).toLocaleTimeString([], { hour12: false }),
    )
  },
)

test(
  [
    'given lib/format::fmtDate',
    'when the input does not parse',
    'it should show the dash placeholder',
  ].join(', '),
  () => {
    // given
    const iso = 'not-a-date'

    // when
    const actual = fmtDate(iso)

    // then
    expect(actual).toBe('—')
  },
)

test(
  [
    'given lib/format::fmtDate',
    'when the input is a real timestamp',
    'it should render a date followed by its clock',
  ].join(', '),
  () => {
    // given
    const iso = '2024-01-01T13:30:00.000Z'

    // when
    const actual = fmtDate(iso)

    // then
    expect(actual).toBe(
      `${new Date(ts(iso)).toLocaleDateString([], { month: 'short', day: 'numeric' })} ${fmtClock(iso)}`,
    )
  },
)

test(
  [
    'given lib/format::fmtTokens',
    'when the count is absent, small, or in the thousands or millions',
    'it should scale the unit to keep the number readable',
  ].join(', '),
  () => {
    // given
    const cases = [
      { n: null, expected: '—' },
      { n: 500, expected: '500' },
      { n: 2500, expected: '2.5k' },
      { n: 2_500_000, expected: '2.50M' },
    ]

    // when
    const actual = cases.map(({ n }) => fmtTokens(n))

    // then
    expect(actual).toEqual(cases.map((c) => c.expected))
  },
)

test(
  [
    'given lib/format::fmtCost',
    'when the amount is absent, under a dollar, or a dollar or more',
    'it should pick the precision that keeps small costs visible',
  ].join(', '),
  () => {
    // given
    const cases = [
      { n: undefined, expected: '—' },
      { n: 0.0032, expected: '$0.0032' },
      { n: 1.5, expected: '$1.50' },
    ]

    // when
    const actual = cases.map(({ n }) => fmtCost(n))

    // then
    expect(actual).toEqual(cases.map((c) => c.expected))
  },
)

test(
  [
    'given lib/format::fmtOffset',
    'when the offset spans seconds, minutes and hours',
    'it should omit a zero remainder instead of a noisy m00s',
  ].join(', '),
  () => {
    // given
    const cases = [
      { ms: 45_000, expected: '45s' },
      { ms: 120_000, expected: '2m' },
      { ms: 90_000, expected: '1m30s' },
      { ms: 3_900_000, expected: '1h05m' },
      { ms: 3_600_000, expected: '1h' },
    ]

    // when
    const actual = cases.map(({ ms }) => fmtOffset(ms))

    // then
    expect(actual).toEqual(cases.map((c) => c.expected))
  },
)

test(
  [
    'given lib/format::axisTicks',
    'when the span is tiny',
    'it should still produce at least the zero tick',
  ].join(', '),
  () => {
    // given
    const spanMs = 0

    // when
    const actual = axisTicks(spanMs)

    // then
    expect(actual[0]).toEqual({ pct: 0, label: '0s' })
  },
)

test(
  [
    'given lib/format::axisTicks',
    'when the span needs a coarser step than any listed',
    'it should fall back to the hourly step',
  ].join(', '),
  () => {
    // given — larger than every step in TICK_STEPS_MS times maxTicks
    const spanMs = 100 * 3_600_000

    // when
    const actual = axisTicks(spanMs, 8)

    // then
    expect(actual[1].label).toBe('1h')
  },
)

test(
  [
    'given lib/format::payloadOk',
    'when the payload is absent, unparsable, or carries no ok key',
    'it should default to ok',
  ].join(', '),
  () => {
    // given
    const cases: readonly (string | null | undefined)[] = [
      null,
      undefined,
      'not json',
      '{}',
    ]

    // when
    const actual = cases.map((raw) => payloadOk(raw))

    // then
    expect(actual).toEqual([true, true, true, true])
  },
)

test(
  [
    'given lib/format::payloadOk',
    'when the payload explicitly marks a tool error',
    'it should read as not ok',
  ].join(', '),
  () => {
    // given
    const raw = JSON.stringify({ ok: false })

    // when
    const actual = payloadOk(raw)

    // then
    expect(actual).toBe(false)
  },
)

test(
  [
    'given lib/format::prettyJson',
    'when the input is absent',
    'it should render as empty',
  ].join(', '),
  () => {
    // given
    const raw = undefined

    // when
    const actual = prettyJson(raw)

    // then
    expect(actual).toBe('')
  },
)

test(
  [
    'given lib/format::prettyJson',
    'when the input parses as JSON',
    'it should pretty-print it',
  ].join(', '),
  () => {
    // given
    const raw = '{"a":1}'

    // when
    const actual = prettyJson(raw)

    // then
    expect(actual).toBe(JSON.stringify({ a: 1 }, null, 2))
  },
)

test(
  [
    'given lib/format::prettyJson',
    'when the input does not parse as JSON',
    'it should return it unchanged rather than throw',
  ].join(', '),
  () => {
    // given
    const raw = 'not json'

    // when
    const actual = prettyJson(raw)

    // then
    expect(actual).toBe('not json')
  },
)
