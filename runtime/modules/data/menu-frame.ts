/**
 * The frame arithmetic behind an arrow-key menu, with no terminal anywhere near it.
 *
 * Everything here is a pure function of a viewport size, a list of options and
 * a cursor: how wide a line prints once its escape codes are stripped, how
 * many terminal ROWS a set of lines costs, which slice of a long list fits
 * the budget, and the strings a frame draws. None of it reads `process.stdout`
 * or writes anywhere — that half stays in `ask.ts`, which calls this module
 * for every line it prints.
 *
 * The rows-versus-lines distinction and the scroll window have both broken
 * before, and both are arithmetic bugs rather than I/O bugs: counting lines
 * instead of rows made every redraw erase too little, and a frame that
 * exactly fills the viewport scrolled it by one when the trailing newline
 * landed. Pulling the arithmetic out from under the terminal is what makes
 * either one testable.
 */

import type { TMenuState } from '../use-cases/menu'
import { visibleWindow } from '../use-cases/menu'
import { paint } from './terminal'

const ESC = '\u001B'

/** The viewport a frame is drawn into. */
export type TViewport = Readonly<{ rows: number; cols: number }>

/** A drawn frame: the lines to print, and the terminal rows they occupy. */
export type TFrame = Readonly<{ lines: readonly string[]; rows: number }>

/** One option as a menu draws it. */
export type TOption = Readonly<{
  /** The value returned when chosen. */
  value: string
  /** What the person reads. */
  label: string
  /** The sentence under it, when there is something worth saying. */
  detail?: string
}>

/**
 * Printable width: escape sequences occupy no columns.
 *
 * Built from the named ESC rather than written as a literal, which is both a
 * control character in a regex source and a second place to get the escape
 * byte right.
 */
const ANSI = new RegExp(`${ESC}\\[[0-9;]*[A-Za-z]`, 'g')

export const widthOf = (line: string): number =>
  line.replaceAll(ANSI, '').length

/**
 * How many ROWS a set of lines occupies, which is not how many lines it is.
 *
 * A line longer than the terminal wraps and costs two rows. Counting lines
 * instead of rows made every redraw erase too little, so a sliver of the
 * previous frame survived each keypress — invisible at 120 columns and
 * obvious at 80.
 */
export const rowsFor = (lines: readonly string[], cols: number): number =>
  lines.reduce(
    (rows, line) => rows + Math.max(1, Math.ceil(widthOf(line) / cols)),
    0,
  )

export const bullet = (chosen: boolean, multiple: boolean): string => {
  if (!multiple) return chosen ? '●' : '○'
  return chosen ? '◉' : '◯'
}

/**
 * Everything a menu's frame needs, computed without touching a stream.
 *
 * Returns the lines to print together with the rows they occupy, rather than
 * printing them — the caller writes the lines and uses the row count to
 * erase the frame it replaces.
 */
export const menuFrame = (
  title: string,
  options: readonly TOption[],
  state: TMenuState,
  multiple: boolean,
  viewport: TViewport,
  preview?: (chosen: readonly string[], highlighted: string) => string,
): TFrame => {
  const { rows, cols } = viewport

  const linesFor = (option: TOption, index: number): readonly string[] => {
    const here = index === state.cursor
    const mark = bullet(state.chosen.includes(index), multiple)
    const head = `${here ? '❯' : ' '} ${mark} ${option.label}`
    const detail = option.detail ?? ''
    return [
      here ? paint(head, 'cyan') : head,
      ...(detail === '' ? [] : [paint(`      ${detail}`, 'dim')]),
    ]
  }

  const help = multiple
    ? '  ↑↓ move · tab select · a all · n none · r reorder · enter confirm · esc cancel'
    : '  ↑↓ move · enter choose · esc cancel'
  /*
   * What the answer currently MEANS, under the options rather than after
   * them. A menu whose selection has to be mentally expanded into a chain is
   * a menu you can leave holding a default you did not notice.
   */
  const summary =
    preview === undefined
      ? []
      : [
          paint(
            `  → ${preview(
              state.chosen
                .map((index) => options[index]?.value)
                .filter((value): value is string => value !== undefined),
              options[state.cursor]?.value ?? '',
            )}`,
            'cyan',
          ),
        ]

  /*
   * Everything that is not an option: the title, the preview, the footer,
   * and a row reserved for each scroll marker whether or not it is shown —
   * budgeting for a marker that then appears would push the frame one row
   * over, which is the whole failure this is avoiding.
   */
  const chrome =
    rowsFor([paint(title, 'bold'), ...summary, paint(help, 'dim')], cols) + 2
  const costs = options.map((option, index) =>
    rowsFor(linesFor(option, index), cols),
  )
  // One row short of the viewport: a frame that exactly fills the screen
  // scrolls it by one when the trailing newline lands.
  const budget = Math.max(1, rows - 1 - chrome)
  const window = visibleWindow(costs, state.cursor, budget)

  const before = window.start
  const after = options.length - window.end
  const shown = options
    .slice(window.start, window.end)
    .flatMap((option, offset) => linesFor(option, window.start + offset))

  const lines = [
    paint(title, 'bold'),
    ...(before > 0 ? [paint(`  ↑ ${before} more`, 'dim')] : []),
    ...shown,
    ...(after > 0 ? [paint(`  ↓ ${after} more`, 'dim')] : []),
    ...summary,
    paint(help, 'dim'),
  ]
  // ROWS, not lines: a wrapped line costs two and erase has to match.
  return { lines, rows: rowsFor(lines, cols) }
}
