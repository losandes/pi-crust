import { expect, test } from 'bun:test'
import {
  applyTheme,
  isTheme,
  resolveTheme,
  saveTheme,
  storedTheme,
  systemTheme,
  type TTheme,
} from './theme-store'

const media =
  (...matching: readonly string[]) =>
  (query: string) => ({ matches: matching.includes(query) })

const recorder = () => {
  const attributes = new Map<string, string>()
  return {
    attributes,
    setAttribute: (name: string, value: string) => {
      attributes.set(name, value)
    },
  }
}

test(
  [
    'given theme::systemTheme',
    'when the system asks for both increased contrast and a light scheme',
    'it should choose high contrast',
  ].join(', '),
  () => {
    // given — contrast is a legibility need; a light preference is taste
    const matchMedia = media(
      '(prefers-contrast: more)',
      '(prefers-color-scheme: light)',
    )

    // when
    const actual = systemTheme(matchMedia)

    // then
    expect(actual).toBe('high-contrast')
  },
)

test(
  [
    'given theme::systemTheme',
    'when the system expresses no preference at all',
    'it should keep the palette the app was designed in',
  ].join(', '),
  () => {
    // given
    const matchMedia = media()

    // when
    const actual = systemTheme(matchMedia)

    // then
    expect(actual).toBe('dark')
  },
)

test(
  [
    'given theme::resolveTheme',
    'when a person has picked a theme explicitly',
    'it should ignore what the system prefers',
  ].join(', '),
  () => {
    // given
    const matchMedia = media('(prefers-color-scheme: light)')

    // when
    const actual = resolveTheme('dark', matchMedia)

    // then
    expect(actual).toBe('dark')
  },
)

test(
  [
    'given theme::storedTheme',
    'when storage holds a theme this app did not ship',
    'it should honour it, because the developer may have registered it',
  ].join(', '),
  () => {
    // given — a theme the developer registers in ~/.pi-crust/config/crust.config.toml.
    // The set of themes is open, so this module cannot tell a team's theme
    // from a typo, and refusing both would make a registered theme
    // unselectable after a reload.
    const storage = { getItem: () => 'midnight' }

    // when
    const actual = storedTheme(storage)

    // then
    expect(actual).toBe('midnight')
  },
)

test(
  [
    'given theme::storedTheme',
    'when storage holds a theme that has since been removed',
    'it should still be honoured, and render as the base palette',
  ].join(', '),
  () => {
    // given — the cost of an open set: nothing here knows the registry, so
    // a stale preference reaches the document, matches no rules, and shows
    // the base palette until somebody picks again. A wrong colour is a
    // cheaper failure than a theme that cannot be chosen.
    const storage = { getItem: () => 'deleted-last-week' }

    // when
    const actual = storedTheme(storage)

    // then
    expect(actual).toBe('deleted-last-week')
  },
)

test(
  [
    'given theme::storedTheme',
    'when reading storage throws because the browser denies it',
    'it should still yield a usable preference',
  ].join(', '),
  () => {
    // given — a private window with storage blocked
    const storage = {
      getItem: () => {
        throw new Error('denied')
      },
    }

    // when
    const actual = storedTheme(storage)

    // then
    expect(actual).toBe('auto')
  },
)

test(
  [
    'given theme::applyTheme',
    'when the preference is auto',
    'it should write a resolved name for the CSS and keep the choice beside it',
  ].join(', '),
  () => {
    // given
    const root = recorder()
    const matchMedia = media('(prefers-color-scheme: light)')

    // when
    const actual = applyTheme(root, 'auto', matchMedia)

    // then — CSS never asks what the system prefers, so palettes stay numbers
    expect(actual).toBe('light')
    expect(root.attributes.get('data-theme')).toBe('light')
    // and the UI can still show Auto as the selected option
    expect(root.attributes.get('data-theme-choice')).toBe('auto')
  },
)

test(
  [
    'given theme::isTheme',
    'when the value is a non-empty string',
    'it should accept it as a theme name',
  ].join(', '),
  () => {
    // given
    const value: unknown = 'midnight'

    // when
    const actual = isTheme(value)

    // then
    expect(actual).toBe(true)
  },
)

test(
  [
    'given theme::isTheme',
    'when the value is empty or not a string',
    'it should reject it',
  ].join(', '),
  () => {
    // given
    const cases: readonly unknown[] = ['', undefined, null, 42]

    // when
    const actual = cases.map((value) => isTheme(value))

    // then
    expect(actual).toEqual([false, false, false, false])
  },
)

test(
  [
    'given theme::saveTheme',
    'when storage accepts the write',
    'it should remember the preference under the theme storage key',
  ].join(', '),
  () => {
    // given
    const stored = new Map<string, string>()
    const storage = {
      setItem: (key: string, value: string) => {
        stored.set(key, value)
      },
    }

    // when
    saveTheme(storage, 'dark')

    // then
    expect(stored.get('crust.theme')).toBe('dark')
  },
)

test(
  [
    'given theme::saveTheme',
    'when storage throws because a private window denies writes',
    'it should not throw, so the session still gets a working theme',
  ].join(', '),
  () => {
    // given
    const storage = {
      setItem: () => {
        throw new Error('denied')
      },
    }

    // when
    const act = () => saveTheme(storage, 'dark')

    // then
    expect(act).not.toThrow()
  },
)

test(
  [
    'given theme::applyTheme',
    'when each selectable theme is applied',
    'it should never write auto as the rendered theme',
  ].join(', '),
  () => {
    // given
    const matchMedia = media()
    const choices: readonly TTheme[] = [
      'auto',
      'light',
      'dark',
      'high-contrast',
    ]

    // when
    const written = choices.map((choice) => {
      const root = recorder()
      applyTheme(root, choice, matchMedia)
      return root.attributes.get('data-theme')
    })

    // then
    expect(written).toEqual(['dark', 'light', 'dark', 'high-contrast'])
  },
)
