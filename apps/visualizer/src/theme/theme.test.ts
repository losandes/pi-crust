import { expect, test } from 'bun:test'
import {
  applyTheme,
  resolveTheme,
  storedTheme,
  systemTheme,
  type TTheme,
} from './theme'

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
    'when storage holds a value this version does not recognise',
    'it should fall back to following the system',
  ].join(', '),
  () => {
    // given — a hand-edited key, or one written by an older spelling
    const storage = { getItem: () => 'midnight' }

    // when
    const actual = storedTheme(storage)

    // then — an unhonourable preference is not an error worth surfacing
    expect(actual).toBe('auto')
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
