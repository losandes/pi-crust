/**
 * The terminal half of the menus: decode bytes, draw options, nothing else.
 *
 * Every decision this module could make lives in `use-cases/menu.ts` instead,
 * so what remains here is the part that genuinely needs a TTY and therefore
 * cannot be unit-tested: raw mode, escape sequences, cursor movement, and the
 * stream writes themselves. The frame arithmetic — row budgets, the scroll
 * window, ANSI width — moved to `menu-frame.ts`, which has no terminal in it
 * and is covered there. This module is excluded from the coverage gate
 * (`bunfig.toml`, `coveragePathIgnorePatterns`) because what remains is a raw
 * mode listener and thin wrappers that sequence it, and no `bun test` process
 * can drive `process.stdin` into raw mode.
 *
 * No dependency for this. A prompt library is a reasonable thing to install,
 * but it brings a theming system, a plugin interface and a release cadence to
 * solve two hundred lines of escape codes in a tool that already owns its own
 * terminal output — and it would be the only runtime dependency besides zod.
 */

import { paint } from '../../../../lib/terminal'
import { moveItem } from '../use-cases/activity-order'
import type { TMenuKey, TMenuState } from '../use-cases/menu'
import {
  applyExclusiveKey,
  applyKey,
  applySingleKey,
  initialMenu,
} from '../use-cases/menu'
import type { TOption } from './menu-frame'
import { menuFrame, rowsFor } from './menu-frame'

export type { TOption } from './menu-frame'

const ESC = '\u001B'

/** The viewport, with a defensible guess when the terminal will not say. */
const viewport = (): Readonly<{ rows: number; cols: number }> => ({
  rows:
    process.stdout.rows && process.stdout.rows > 0 ? process.stdout.rows : 24,
  cols:
    process.stdout.columns && process.stdout.columns > 0
      ? process.stdout.columns
      : 80,
})

const write = (text: string): void => {
  process.stdout.write(text)
}

export const NOT_A_TERMINAL =
  'please needs a terminal to ask questions in — it is a menu, not a flag. ' +
  'Run it directly (`just crust please`), or use the command it would have ' +
  'built: `just crust sdlc "\u2026"`.'

/**
 * Decode a read into the keys it contains — plural, deliberately.
 *
 * One read is NOT one keypress. A terminal delivers whatever has arrived, so
 * pressing down-then-enter quickly hands over `\x1b[B\r` in a single chunk,
 * and so does any paste. Treating a chunk as one key silently dropped both:
 * the menu ignored an unrecognised blob and the person watched their
 * keystrokes do nothing, which is indistinguishable from a hung program.
 *
 * Unrecognised bytes are skipped rather than guessed at — a mouse report or
 * a bracketed-paste marker must never count as enter.
 *
 * Keys that arrive in the same chunk AFTER the one that closes a menu are
 * dropped: typing ahead into the next question does not work. Carrying a
 * buffer between questions would fix it, at the cost of making every prompt
 * share mutable state — not worth it for a wizard whose next frame takes a
 * millisecond to appear.
 */
/**
 * Every token in one read: an arrow sequence, an escape, or a single char.
 *
 * Built from the named ESC rather than written as a literal `\x1b`, which is
 * both a control character in a regex source and a second place to get the
 * escape byte right. `s` so `.` matches a newline, which IS a key here.
 */
const TOKENS = new RegExp(`${ESC}\\[[A-Z]|${ESC}|.`, 'gs')

export const decodeKeys = (data: string): readonly TMenuKey[] =>
  (data.match(TOKENS) ?? [])
    .map(decodeToken)
    .filter((key): key is TMenuKey => key !== undefined)

const decodeToken = (token: string): TMenuKey | undefined => {
  if (token === `${ESC}[A`) return 'up'
  if (token === `${ESC}[B`) return 'down'
  // A bare escape means "I am leaving". Arrows also start with one, but they
  // were already consumed whole by the token pattern above.
  if (token === ESC) return 'cancel'
  if (token.startsWith(ESC)) return undefined
  return decodeChar(token)
}

const decodeChar = (char: string): TMenuKey | undefined => {
  /*
   * j/k keep their own identity rather than being folded into up/down here.
   *
   * A menu reads them as the cursor, and the ordering screen moves the STEP
   * with them — which it can only do if the decoder has not already thrown
   * away which key was pressed. They were capitals for exactly that reason,
   * and a shift chord to nudge a list is a chord nobody should have to hold.
   */
  if (char === 'k') return 'vimUp'
  if (char === 'j') return 'vimDown'
  if (char === '\t' || char === ' ') return 'toggle'
  if (char === '\r' || char === '\n') return 'submit'
  // Ctrl-C and Escape both mean "I am leaving", and both must work: a person
  // reaching for escape should not have to discover that only one of them does.
  if (char === '\u0003') return 'cancel'
  if (char === 'a') return 'all'
  if (char === 'n') return 'none'
  if (char === 'r') return 'reorder'
  // The capitals still work, for hands that learned them this afternoon.
  if (char === 'J') return 'vimDown'
  if (char === 'K') return 'vimUp'
  return undefined
}

/** Draw one frame of a menu: compute it in `menu-frame.ts`, print it here. */
const draw = (
  title: string,
  options: readonly TOption[],
  state: TMenuState,
  multiple: boolean,
  preview?: (chosen: readonly string[], highlighted: string) => string,
): number => {
  const frame = menuFrame(title, options, state, multiple, viewport(), preview)
  write(`${frame.lines.join('\n')}\n`)
  return frame.rows
}

/** Erase what we just drew, so the next frame replaces it rather than stacking. */
const erase = (lines: number): void => {
  write(`${ESC}[${lines}A${ESC}[0J`)
}

/**
 * A menu needs a terminal, and saying so is better than crashing.
 *
 * Piped into, `setRawMode` is simply absent, and the failure reads as an
 * internal TypeError with no hint that the real problem is that nobody is
 * there to press a key.
 */
export const interactive = (): boolean =>
  process.stdin.isTTY === true && typeof process.stdin.setRawMode === 'function'

/**
 * Read keys until the caller says stop.
 *
 * Deliberately a listener and not `for await (… of process.stdin)`. Breaking
 * out of a for-await loop calls `return()` on the stream's iterator, which
 * DESTROYS stdin — so the first menu worked, and every question after it read
 * from a dead stream and hung with the frame still on screen. A listener that
 * is added and removed leaves the stream exactly as it found it.
 */
const onKeys = (handle: (key: TMenuKey) => boolean): Promise<void> =>
  new Promise((resolve) => {
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf8')

    const listener = (chunk: string): void => {
      for (const key of decodeKeys(String(chunk))) {
        if (handle(key)) {
          process.stdin.off('data', listener)
          process.stdin.setRawMode(false)
          process.stdin.pause()
          resolve()
          return
        }
      }
    }
    process.stdin.on('data', listener)
  })

/**
 * Run a menu to completion.
 *
 * Returns the chosen values in selection order, or undefined when cancelled —
 * which the caller must treat as "they changed their mind", not as an empty
 * selection. Those mean opposite things.
 */
/** What a menu returned, and whether another question was asked for. */
export type TMenuChoice = Readonly<{
  /** Chosen values, or undefined when they backed out. */
  values: readonly string[] | undefined
  /** They pressed `r`: the caller should offer an ordering. */
  reorder: boolean
}>

export const askMenuChoice = async (
  title: string,
  options: readonly TOption[],
  config: Readonly<{
    multiple: boolean
    preselected?: readonly number[]
    cursor?: number
    /** Options that cannot be combined with anything else. */
    exclusive?: readonly number[]
    /**
     * What the current state means, drawn under the options.
     *
     * Given the selection AND whatever the cursor is on, so a menu can show
     * what the highlighted option WOULD do before it is taken. A preview
     * that only moves when something is ticked makes you tick things to find
     * out what they are.
     */
    preview?: (chosen: readonly string[], highlighted: string) => string
  }>,
): Promise<TMenuChoice> => {
  if (options.length === 0) return { values: [], reorder: false }
  if (!interactive()) throw new Error(NOT_A_TERMINAL)
  const exclusive = config.exclusive ?? []
  let state = initialMenu(config.preselected ?? [], config.cursor ?? 0)
  let height = draw(title, options, state, config.multiple, config.preview)

  const advance = (key: TMenuKey): TMenuState => {
    if (!config.multiple) return applySingleKey(state, key, options.length)
    return exclusive.length === 0
      ? applyKey(state, key, options.length)
      : applyExclusiveKey(state, key, options.length, exclusive)
  }

  await onKeys((key) => {
    state = advance(key)
    erase(height)
    height = draw(title, options, state, config.multiple, config.preview)
    return state.done || state.cancelled
  })

  if (state.cancelled) return { values: undefined, reorder: false }
  return {
    values: state.chosen
      .map((index) => options[index]?.value)
      .filter((value): value is string => value !== undefined),
    reorder: state.reorder,
  }
}

/**
 * A menu for callers that do not offer ordering — most of them.
 *
 * Kept so adding `r` to one question did not change the signature every
 * other question is asked with.
 */
export const askMenu = async (
  title: string,
  options: readonly TOption[],
  config: Parameters<typeof askMenuChoice>[2],
): Promise<readonly string[] | undefined> =>
  (await askMenuChoice(title, options, config)).values

/**
 * Put a chosen list in the order it should run.
 *
 * `↑`/`↓` (or `j`/`k`) move the cursor; `J`/`K` move the STEP. That pairing
 * is the one thing a reorder screen must make obvious, and it is why the
 * footer says it rather than leaving it to be discovered.
 *
 * Shown only when asked for, so the ordinary run — take the configured order
 * and go — pays nothing for it.
 */
export const askOrder = async (
  title: string,
  items: readonly string[],
): Promise<readonly string[] | undefined> => {
  if (items.length < 2) return items
  if (!interactive()) throw new Error(NOT_A_TERMINAL)

  let ordered: readonly string[] = [...items]
  let cursor = 0
  let cancelled = false

  const render = (): number => {
    const lines = [
      paint(title, 'bold'),
      ...ordered.map((item, index) => {
        const line = `${index === cursor ? '❯' : ' '} ${index + 1}. ${item}`
        return index === cursor ? paint(line, 'cyan') : line
      }),
      paint(`  → ${ordered.join(' → ')}`, 'cyan'),
      paint(
        '  ↑↓ cursor · j/k move the activity · enter confirm · esc cancel',
        'dim',
      ),
    ]
    write(`${lines.join('\n')}\n`)
    return rowsFor(lines, viewport().cols)
  }

  let height = render()

  await onKeys((key) => {
    if (key === 'cancel') {
      cancelled = true
      return true
    }
    if (key === 'submit' || key === 'reorder') return true
    // Arrows move the cursor; j/k move the activity. Here the arrows are free to
    // take the cursor on their own, so the letters can do the useful thing.
    if (key === 'up') cursor = Math.max(0, cursor - 1)
    if (key === 'down') cursor = Math.min(ordered.length - 1, cursor + 1)
    if (key === 'vimUp' || key === 'vimDown') {
      const delta = key === 'vimUp' ? -1 : 1
      const moved = moveItem(ordered, cursor, delta)
      // The cursor follows the activity it is holding; losing it would mean a
      // second press moved whatever had slid into that slot instead.
      if (moved !== ordered) cursor += delta
      ordered = moved
    }
    erase(height)
    height = render()
    return false
  })

  return cancelled ? undefined : ordered
}

/** A single choice. Convenience over askMenu, because it is most of the uses. */
export const askOne = async (
  title: string,
  options: readonly TOption[],
  cursor = 0,
): Promise<string | undefined> => {
  const chosen = await askMenu(title, options, { multiple: false, cursor })
  return chosen?.[0]
}

/**
 * A line of text.
 *
 * Line mode, not raw: this is where backspace, arrow keys, kill-line and
 * paste must all behave, and the terminal already implements every one of
 * them correctly. Re-implementing editing on top of raw mode is how a wizard
 * ends up worse at typing than the shell it was launched from.
 */
export const askText = async (
  title: string,
  fallback = '',
): Promise<string | undefined> => {
  if (!interactive()) throw new Error(NOT_A_TERMINAL)
  write(`${paint(title, 'bold')}\n`)
  if (fallback !== '') write(paint(`  default: ${fallback}\n`, 'dim'))
  write('  ')

  /*
   * Line mode, not raw: this is where backspace, arrow keys, kill-line and
   * paste must all behave, and the terminal already implements every one of
   * them correctly. Re-implementing editing on raw mode is how a wizard ends
   * up worse at typing than the shell it was launched from.
   */
  return await new Promise<string | undefined>((resolve) => {
    process.stdin.setRawMode(false)
    process.stdin.resume()
    process.stdin.setEncoding('utf8')
    let buffer = ''
    const listener = (chunk: string): void => {
      buffer += String(chunk)
      const newline = buffer.indexOf('\n')
      if (newline === -1) return
      const line = buffer.slice(0, newline).replace(/\r$/, '')
      process.stdin.off('data', listener)
      process.stdin.pause()
      resolve(line === '' ? fallback : line)
    }
    process.stdin.on('data', listener)
  })
}
