import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  authHeaders,
  explainWriteFailure,
  readToken,
  TOKEN_HEADER,
  TOKEN_KEY,
  writeToken,
} from './token-store'

const makeLocalStorage = () => {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
  }
}

let originalWindow: unknown

beforeEach(() => {
  originalWindow = (globalThis as { window?: unknown }).window
})

afterEach(() => {
  // biome-ignore lint/plugin/no-object-mutation: globalThis.window is the external seam these tests stub; this is the adapter that owns the assignment
  ;(globalThis as { window?: unknown }).window = originalWindow
})

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
    const actual = explainWriteFailure(
      status,
      'kind must be steer, follow_up or abort',
    )

    // then
    expect(actual).toBe('kind must be steer, follow_up or abort')
  },
)

test(
  [
    'given lib/token::readToken and writeToken',
    'when a token is written and then read back',
    'it should round-trip through localStorage, trimmed',
  ].join(', '),
  () => {
    // given
    // biome-ignore lint/plugin/no-object-mutation: globalThis.window is the external seam these tests stub; this is the adapter that owns the assignment
    ;(globalThis as { window?: unknown }).window = {
      localStorage: makeLocalStorage(),
    }

    // when
    writeToken('  secret-token  ')
    const actual = readToken()

    // then
    expect(actual).toBe('secret-token')
  },
)

test(
  [
    'given lib/token::readToken',
    'when nothing has been stored',
    'it should read as an empty string rather than null',
  ].join(', '),
  () => {
    // given
    // biome-ignore lint/plugin/no-object-mutation: globalThis.window is the external seam these tests stub; this is the adapter that owns the assignment
    ;(globalThis as { window?: unknown }).window = {
      localStorage: makeLocalStorage(),
    }

    // when
    const actual = readToken()

    // then
    expect(actual).toBe('')
  },
)

test(
  [
    'given lib/token::readToken and writeToken',
    'when localStorage throws, as it does in a private window that denies it',
    'it should fail soft rather than throw',
  ].join(', '),
  () => {
    // given
    const deny = () => {
      throw new Error('denied')
    }
    // biome-ignore lint/plugin/no-object-mutation: globalThis.window is the external seam these tests stub; this is the adapter that owns the assignment
    ;(globalThis as { window?: unknown }).window = {
      localStorage: { getItem: deny, setItem: deny },
    }

    // when
    const actRead = () => readToken()
    const actWrite = () => writeToken('x')

    // then
    expect(actRead()).toBe('')
    expect(actWrite).not.toThrow()
  },
)

test(
  [
    'given lib/token::authHeaders',
    'when no token has been given',
    'it should carry no header at all, rather than an empty one',
  ].join(', '),
  () => {
    // given
    // biome-ignore lint/plugin/no-object-mutation: globalThis.window is the external seam these tests stub; this is the adapter that owns the assignment
    ;(globalThis as { window?: unknown }).window = {
      localStorage: makeLocalStorage(),
    }

    // when
    const actual = authHeaders()

    // then
    expect(actual).toEqual({})
  },
)

test(
  [
    'given lib/token::authHeaders',
    'when a token has been given',
    'it should carry it under the write header',
  ].join(', '),
  () => {
    // given
    const storage = makeLocalStorage()
    storage.setItem(TOKEN_KEY, 'abc123')
    // biome-ignore lint/plugin/no-object-mutation: globalThis.window is the external seam these tests stub; this is the adapter that owns the assignment
    ;(globalThis as { window?: unknown }).window = { localStorage: storage }

    // when
    const actual = authHeaders()

    // then
    expect(actual).toEqual({ [TOKEN_HEADER]: 'abc123' })
  },
)
