import { expect, test } from 'bun:test'
import { BUILTIN_THEMES } from '../typedefs/registered-theme'
import { applyCustomThemes, CUSTOM_STYLE_ID } from './apply-custom-themes'

type TElement = { id: string; textContent: string }

const fakeDocument = (existing?: TElement) => {
  let appended: readonly TElement[] = []
  return {
    appended: () => appended,
    getElementById: (id: string) =>
      existing !== undefined && existing.id === id ? existing : null,
    createElement: () => ({ id: '', textContent: '' }) as TElement,
    head: {
      appendChild: (node: TElement) => {
        appended = [...appended, node]
      },
    },
  }
}

test(
  [
    'given theme/registered::applyCustomThemes',
    'when a repository defines a theme',
    'it should put its css on the page',
  ].join(', '),
  () => {
    // given
    const given = fakeDocument()

    // when
    applyCustomThemes(given as never, [
      { name: 'midnight', label: 'Midnight', builtin: false, css: '.x{}' },
    ])

    // then
    expect(given.appended()[0]?.id).toBe(CUSTOM_STYLE_ID)
    expect(given.appended()[0]?.textContent).toBe('.x{}')
  },
)

test(
  [
    'given theme/registered::applyCustomThemes',
    'when only builtins are registered',
    'it should write nothing, because their styles already shipped',
  ].join(', '),
  () => {
    // given
    const given = fakeDocument()

    // when
    const actual = applyCustomThemes(given as never, BUILTIN_THEMES)

    // then
    expect(actual).toBe('')
  },
)

test(
  [
    'given theme/registered::applyCustomThemes',
    'when a theme is removed and the styles are reapplied',
    'it should replace the block rather than leave the old rules behind',
  ].join(', '),
  () => {
    // given — one element holding every custom theme, so a removal is a
    // rewrite rather than a hunt for the element that owned it
    const existing: TElement = { id: CUSTOM_STYLE_ID, textContent: '.old{}' }
    const given = fakeDocument(existing)

    // when
    applyCustomThemes(given as never, [
      { name: 'new', label: 'New', builtin: false, css: '.new{}' },
    ])

    // then
    expect(existing.textContent).toBe('.new{}')
    expect(given.appended()).toHaveLength(0)
  },
)
