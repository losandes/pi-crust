import { expect, test } from 'bun:test'
import { initialMenu } from '../use-cases/menu'
import type { TOption, TViewport } from './menu-frame'
import { bullet, menuFrame, rowsFor, widthOf } from './menu-frame'

const options = (count: number): readonly TOption[] =>
  Array.from({ length: count }, (_, index) => ({
    value: `v${index}`,
    label: `option ${index}`,
  }))

const viewport = (rows: number, cols = 80): TViewport => ({ rows, cols })

test(
  [
    'given data/menu-frame::widthOf',
    'when a line carries an ANSI colour code',
    'it should count only the printable characters',
  ].join(' '),
  () => {
    // given
    const painted = '\u001B[36mhello\u001B[0m'

    // when
    const width = widthOf(painted)

    // then
    expect(width).toBe(5)
  },
)

test(
  [
    'given data/menu-frame::rowsFor',
    'when a line is wider than the viewport',
    'it should cost more than one row, because an erase that counts lines leaves a sliver on screen',
  ].join(' '),
  () => {
    // given
    const lines = ['a'.repeat(100)]

    // when
    const rows = rowsFor(lines, 80)

    // then
    expect(rows).toBe(2)
  },
)

test(
  [
    'given data/menu-frame::rowsFor',
    'when every line fits within the viewport width',
    'it should cost exactly one row per line',
  ].join(' '),
  () => {
    // given
    const lines = ['short', 'also short']

    // when
    const rows = rowsFor(lines, 80)

    // then
    expect(rows).toBe(2)
  },
)

test(
  [
    'given data/menu-frame::bullet',
    'when the menu allows multiple selections',
    'it should use the filled and hollow square bullets',
  ].join(' '),
  () => {
    // given, when
    const chosen = bullet(true, true)
    const unchosen = bullet(false, true)

    // then
    expect(chosen).toBe('◉')
    expect(unchosen).toBe('◯')
  },
)

test(
  [
    'given data/menu-frame::bullet',
    'when the menu allows only a single selection',
    'it should use the filled and hollow circle bullets',
  ].join(' '),
  () => {
    // given, when
    const chosen = bullet(true, false)
    const unchosen = bullet(false, false)

    // then
    expect(chosen).toBe('●')
    expect(unchosen).toBe('○')
  },
)

test(
  [
    'given data/menu-frame::menuFrame',
    'when the option list is shorter than the row budget',
    'it should show every option with no scroll markers',
  ].join(' '),
  () => {
    // given
    const list = options(3)
    const state = initialMenu([], 0)

    // when
    const frame = menuFrame('pick one', list, state, false, viewport(24))

    // then
    expect(frame.lines.some((line) => line.includes('more'))).toBe(false)
    expect(frame.lines.some((line) => line.includes('option 0'))).toBe(true)
    expect(frame.lines.some((line) => line.includes('option 2'))).toBe(true)
  },
)

test(
  [
    'given data/menu-frame::menuFrame',
    'when the viewport is too short to show the whole list and the cursor sits above the window',
    'it should show the cursor option and a more-below indicator',
  ].join(' '),
  () => {
    // given
    const list = options(20)
    const state = initialMenu([], 0)

    // when
    const frame = menuFrame('pick one', list, state, false, viewport(10))

    // then
    expect(frame.lines.some((line) => line.includes('option 0'))).toBe(true)
    expect(
      frame.lines.some((line) => line.includes('↓') && line.includes('more')),
    ).toBe(true)
    expect(
      frame.lines.some((line) => line.includes('↑') && line.includes('more')),
    ).toBe(false)
  },
)

test(
  [
    'given data/menu-frame::menuFrame',
    'when the viewport is too short to show the whole list and the cursor sits below the window',
    'it should show the cursor option and a more-above indicator',
  ].join(' '),
  () => {
    // given
    const list = options(20)
    const state = initialMenu([], 19)

    // when
    const frame = menuFrame('pick one', list, state, false, viewport(10))

    // then
    expect(frame.lines.some((line) => line.includes('option 19'))).toBe(true)
    expect(
      frame.lines.some((line) => line.includes('↑') && line.includes('more')),
    ).toBe(true)
    expect(
      frame.lines.some((line) => line.includes('↓') && line.includes('more')),
    ).toBe(false)
  },
)

test(
  [
    'given data/menu-frame::menuFrame',
    'when the cursor sits in the middle of a list too long for the viewport',
    'it should show both a more-above and a more-below indicator',
  ].join(' '),
  () => {
    // given
    const list = options(30)
    const state = initialMenu([], 15)

    // when
    const frame = menuFrame('pick one', list, state, false, viewport(10))

    // then
    expect(
      frame.lines.some((line) => line.includes('↑') && line.includes('more')),
    ).toBe(true)
    expect(
      frame.lines.some((line) => line.includes('↓') && line.includes('more')),
    ).toBe(true)
  },
)

test(
  [
    'given data/menu-frame::menuFrame',
    'when asked for a frame',
    'it should report rows computed from the printed lines rather than the line count',
  ].join(' '),
  () => {
    // given
    const list: readonly TOption[] = [{ value: 'v', label: 'a'.repeat(100) }]
    const state = initialMenu([], 0)

    // when
    const frame = menuFrame('title', list, state, false, viewport(24, 80))

    // then
    expect(frame.rows).toBeGreaterThan(frame.lines.length)
  },
)

test(
  [
    'given data/menu-frame::menuFrame',
    'when an option carries a detail line and the menu allows multiple selections',
    'it should print the detail under the option and the multiple-select footer',
  ].join(' '),
  () => {
    // given
    const list: readonly TOption[] = [
      { value: 'v', label: 'option', detail: 'the detail' },
    ]
    const state = initialMenu([0], 0)

    // when
    const frame = menuFrame('title', list, state, true, viewport(24))

    // then
    expect(frame.lines.some((line) => line.includes('the detail'))).toBe(true)
    expect(frame.lines.some((line) => line.includes('reorder'))).toBe(true)
  },
)

test(
  [
    'given data/menu-frame::menuFrame',
    'when a preview is given',
    'it should show what the current selection and highlight mean, under the options',
  ].join(' '),
  () => {
    // given
    const list = options(2)
    const state = initialMenu([0], 1)
    const preview = (chosen: readonly string[], highlighted: string): string =>
      `chosen=${chosen.join(',')} highlighted=${highlighted}`

    // when
    const frame = menuFrame('title', list, state, true, viewport(24), preview)

    // then
    expect(
      frame.lines.some((line) => line.includes('chosen=v0 highlighted=v1')),
    ).toBe(true)
  },
)
