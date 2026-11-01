import { expect, test } from 'bun:test'
import { themesUrl } from './use-registered-themes'

test(
  [
    'given theme::themesUrl',
    'when no workspace is given',
    'it should request the unscoped endpoint',
  ].join(', '),
  () => {
    // given / when
    const actual = themesUrl(undefined)

    // then
    expect(actual).toBe('/api/themes')
  },
)

test(
  [
    'given theme::themesUrl',
    'when a workspace label is given',
    'it should scope the request to it',
  ].join(', '),
  () => {
    // given / when
    const actual = themesUrl('my-tree')

    // then
    expect(actual).toBe('/api/themes?workspace=my-tree')
  },
)

test(
  [
    'given theme::themesUrl',
    'when the label needs URL encoding',
    'it should encode it rather than splitting the query string',
  ].join(', '),
  () => {
    // given / when
    const actual = themesUrl('feat/crust agent')

    // then
    expect(actual).toBe('/api/themes?workspace=feat%2Fcrust%20agent')
  },
)
