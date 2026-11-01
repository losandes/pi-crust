import { expect, test } from 'bun:test'
import {
  errorMessage,
  fail,
  isOk,
  safeParseSettlement,
  settledOr,
  succeed,
} from './settlement'

test(
  [
    'given typedefs/settlement::succeed',
    'when a value settles successfully',
    'it should carry the data under status ok',
  ].join(', '),
  () => {
    // given, when
    const actual = succeed(42)

    // then
    expect(actual).toEqual({ status: 'ok', data: 42 })
  },
)

test(
  [
    'given typedefs/settlement::fail',
    'when an operation settles with a failure',
    'it should carry the error under status error',
  ].join(', '),
  () => {
    // given
    const error = new Error('boom')

    // when
    const actual = fail(error)

    // then
    expect(actual).toEqual({ status: 'error', error })
  },
)

test(
  [
    'given typedefs/settlement::isOk',
    'when the settlement is a success',
    'it should narrow true',
  ].join(', '),
  () => {
    // given, when
    const actual = isOk(succeed('x'))

    // then
    expect(actual).toBe(true)
  },
)

test(
  [
    'given typedefs/settlement::isOk',
    'when the settlement is a failure',
    'it should narrow false',
  ].join(', '),
  () => {
    // given, when
    const actual = isOk(fail(new Error('boom')))

    // then
    expect(actual).toBe(false)
  },
)

test(
  [
    'given typedefs/settlement::safeParseSettlement',
    'when the wrapped call returns normally',
    'it should settle ok with its value',
  ].join(', '),
  () => {
    // given, when
    const actual = safeParseSettlement(() => 7)

    // then
    expect(actual).toEqual({ status: 'ok', data: 7 })
  },
)

test(
  [
    'given typedefs/settlement::safeParseSettlement',
    'when the wrapped call throws a non-Error value',
    'it should settle error, wrapping it in a real Error',
  ].join(', '),
  () => {
    // given
    const compute = () => {
      throw 'raw string failure'
    }

    // when
    const actual = safeParseSettlement(compute)

    // then
    expect(actual.status).toEqual('error')
    expect(actual.status === 'error' && actual.error.message).toEqual(
      'raw string failure',
    )
  },
)

test(
  [
    'given typedefs/settlement::settledOr',
    'when the settlement is ok',
    'it should return the settled value, not the fallback',
  ].join(', '),
  () => {
    // given, when
    const actual = settledOr(succeed('value'), 'fallback')

    // then
    expect(actual).toEqual('value')
  },
)

test(
  [
    'given typedefs/settlement::settledOr',
    'when the settlement failed',
    'it should return the fallback',
  ].join(', '),
  () => {
    // given, when
    const actual = settledOr(fail(new Error('boom')), 'fallback')

    // then
    expect(actual).toEqual('fallback')
  },
)

test(
  [
    'given typedefs/settlement::errorMessage',
    'when the thrown value is a real Error',
    'it should return its message',
  ].join(', '),
  () => {
    // given, when
    const actual = errorMessage(new Error('boom'))

    // then
    expect(actual).toEqual('boom')
  },
)

test(
  [
    'given typedefs/settlement::errorMessage',
    'when the thrown value is not an Error',
    'it should stringify it',
  ].join(', '),
  () => {
    // given, when
    const actual = errorMessage('raw string failure')

    // then
    expect(actual).toEqual('raw string failure')
  },
)
