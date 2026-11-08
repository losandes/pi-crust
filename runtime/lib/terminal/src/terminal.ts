/**
 * The terminal: ANSI colour and one box, hand-rolled.
 *
 * Plain sequential lines only — no spinners, no live displays — so a CI log
 * reads exactly like a terminal. This module writes; deciding WHAT to write is
 * `use-cases/report-to-console.ts`.
 */

const CODES = {
  reset: '\u001B[0m',
  bold: '\u001B[1m',
  dim: '\u001B[2m',
  red: '\u001B[31m',
  green: '\u001B[32m',
  yellow: '\u001B[33m',
  magenta: '\u001B[35m',
  cyan: '\u001B[36m',
} as const

export type TStyle = keyof typeof CODES

export const KIND_COLOR: Readonly<Record<string, TStyle>> = {
  engineer: 'cyan',
  agent: 'magenta',
  code: 'yellow',
}

/** dynamic text (summaries, violations, errors) is clipped */
export const MAX_LINE = 160

export const clip = (text: string, limit: number = MAX_LINE): string => {
  const collapsed = String(text).split(/\s+/).filter(Boolean).join(' ')
  return collapsed.length <= limit
    ? collapsed
    : `${collapsed.slice(0, limit - 1)}…`
}

export const paint = (text: string, ...styles: readonly TStyle[]): string =>
  styles.length === 0
    ? text
    : `${styles.map((style) => CODES[style]).join('')}${text}${CODES.reset}`

/** Strip styling, so the traced copy of a line is the plain words. */
export const plain = (text: string): string =>
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching the ANSI escape is the whole job
  text.replace(/\u001B\[[0-9;]*m/g, '')

export const writeLine = (text: string): void => {
  process.stdout.write(`${text}\n`)
}

/** The completion panel: a titled box around pre-rendered rows. */
export const box = (
  title: string,
  rows: readonly string[],
  style: TStyle,
): string => {
  const width = Math.max(
    plain(title).length + 2,
    ...rows.map((row) => plain(row).length),
  )
  const edge = (left: string, right: string, label = ''): string =>
    paint(
      `${left}${label}${'─'.repeat(Math.max(0, width + 2 - plain(label).length))}${right}`,
      style,
    )
  const side = paint('│', style)
  return [
    edge('╭', '╮', `─ ${title} `),
    ...rows.map(
      (row) =>
        `${side} ${row}${' '.repeat(Math.max(0, width - plain(row).length))} ${side}`,
    ),
    edge('╰', '╯'),
  ].join('\n')
}
