import { expect, test } from 'bun:test'
import { explainWriteFailure } from './token'

test(
  [
    'given lib/token::explainWriteFailure',
    'when the server has no token configured',
    'it should say the server is the thing to fix, not the token field',
  ].join(', '),
  () => {
    // given — 503 means writes are off entirely; pasting a token cannot help
    const status = 503

    // when
    const actual = explainWriteFailure(status, '')

    // then
    expect(actual).toContain('CRUST_TOKEN set')
  },
)

test(
  [
    'given lib/token::explainWriteFailure',
    'when the token was refused',
    'it should say so rather than reporting a generic failure',
  ].join(', '),
  () => {
    // given — 401 and 503 are different problems with different fixes, and
    // "request failed" tells a reader neither of them
    const status = 401

    // when
    const actual = explainWriteFailure(status, '')

    // then
    expect(actual).toContain('not accepted')
  },
)

test(
  [
    'given lib/token::explainWriteFailure',
    'when the server explained itself',
    'it should repeat the server rather than inventing a summary',
  ].join(', '),
  () => {
    // given
    const status = 400

    // when
    const actual = explainWriteFailure(status, 'kind must be steer, follow_up or abort')

    // then
    expect(actual).toBe('kind must be steer, follow_up or abort')
  },
)
