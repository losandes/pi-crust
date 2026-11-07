/**
 * Custom markdownlint rule: a table's columns line up in the source.
 *
 * markdownlint has no rule for this. MD055 governs the leading and trailing
 * pipes and MD056 the column count; both are width-independent, so a table
 * whose cells are jammed against the pipes passes every built-in rule.
 *
 * The reasoning, and the diff cost this accepts, are in
 * `adr/conventions/format-markdown.md`.
 *
 * The rule carries `fixInfo`, so `markdownlint-cli2 --fix` does the padding.
 * Nothing else implements it: a second copy in the repair script would be a
 * fixer that can disagree with its own checker.
 *
 * A cell's width is counted in code points, not grapheme clusters or terminal
 * columns. Combining marks, emoji sequences and East Asian wide characters
 * will therefore align by one measure and look wrong by another. Every
 * document this governs is written in Latin script, so the simpler count is
 * the one in use; revisit it when that stops being true rather than now.
 *
 * Detection is textual rather than token-based, unlike `no-hard-wrap`.
 * micromark reports where a table is but not how its source was spaced, and
 * the padding is a property of the source alone.
 */

/** A pipe not preceded by a backslash. An escaped pipe is cell content. */
const CELL_BOUNDARY: RegExp = /(?<!\\)\|/

/** A separator cell: dashes, optionally fenced by alignment colons. */
const SEPARATOR_CELL = /^:?-+:?$/

/** The narrowest separator GitHub still parses as one. */
const MIN_SEPARATOR = 3

/** Any line that could be part of a table: optional indent, then a pipe. */
const TABLE_LINE = /^(\s*)\|/

type Alignment = 'left' | 'right' | 'center' | 'none'

type TableBlock = {
  /** 0-based index of the block's first line within the document. */
  readonly start: number
  /** 0-based index one past the block's last line. */
  readonly end: number
  readonly lines: readonly string[]
}

type Misaligned = {
  readonly block: TableBlock
  readonly aligned: readonly string[]
}

/**
 * Split a row into trimmed cells, discarding the leading and trailing pipes
 * the record requires (MD055). A row with no interior content yields no
 * cells, which keeps a stray `||` from being treated as a table.
 */
const cellsOf = (line: string): readonly string[] => {
  const trimmed = line.trim()
  const inner = trimmed.replace(/^\|/, '').replace(/\|$/, '')

  return inner.split(CELL_BOUNDARY).map((cell) => cell.trim())
}

const isSeparatorRow = (line: string): boolean => {
  const cells = cellsOf(line)

  return cells.length > 0 && cells.every((cell) => SEPARATOR_CELL.test(cell))
}

/** `left`, `right`, `center`, or `none`, read from the separator's colons. */
const alignmentOf = (cell: string): Alignment => {
  const left = cell.startsWith(':')
  const right = cell.endsWith(':')

  return left && right ? 'center' : left ? 'left' : right ? 'right' : 'none'
}

const widthOf = (cell: string): number => [...cell].length

/**
 * Collect the maximal runs of consecutive table lines in a document, each
 * tagged with the line it starts on. Fenced blocks are excluded by the
 * caller, which is the only context that knows where fences are.
 */
const tableBlocks = (lines: readonly string[]): readonly TableBlock[] =>
  lines.reduce<readonly TableBlock[]>((blocks, line, index) => {
    const open = blocks[blocks.length - 1]
    const isTable = TABLE_LINE.test(line)

    return isTable && open !== undefined && open.end === index
      ? [
          ...blocks.slice(0, -1),
          { start: open.start, end: index + 1, lines: [...open.lines, line] },
        ]
      : isTable
        ? [...blocks, { start: index, end: index + 1, lines: [line] }]
        : blocks
  }, [])

/**
 * A run of table lines is a table only if its second line is a separator.
 * Without that, GitHub renders the pipes as literal text, and padding them
 * would be rewriting prose that merely looks tabular.
 */
const isTable = (block: TableBlock): boolean =>
  block.lines.length >= 2 && isSeparatorRow(block.lines[1] ?? '')

/**
 * Rewrite a table so every column is as wide as its widest cell.
 *
 * Content is left-aligned in every column, including columns the separator
 * marks as right-aligned or centred. The colons survive, so the rendered
 * table is unchanged; only the source differs, and padding content away from
 * the pipe it is aligned to would make the source harder to read rather than
 * easier.
 */
const alignBlock = (block: TableBlock): readonly string[] => {
  const indent = (block.lines[0]?.match(TABLE_LINE) ?? ['', ''])[1] ?? ''
  const rows = block.lines.map(cellsOf)
  const separatorIndex = 1
  const columns = Math.max(...rows.map((row) => row.length))

  const alignments = Array.from({ length: columns }, (_, column) =>
    alignmentOf(rows[separatorIndex]?.[column] ?? ''),
  )

  const widths = Array.from({ length: columns }, (_, column) =>
    Math.max(
      MIN_SEPARATOR,
      ...rows.map((row, index) =>
        index === separatorIndex ? 0 : widthOf(row[column] ?? ''),
      ),
    ),
  )

  const separatorFor = (alignment: Alignment, width: number): string =>
    alignment === 'center'
      ? `:${'-'.repeat(width - 2)}:`
      : alignment === 'left'
        ? `:${'-'.repeat(width - 1)}`
        : alignment === 'right'
          ? `${'-'.repeat(width - 1)}:`
          : '-'.repeat(width)

  return rows.map((row, index) => {
    const cells = Array.from({ length: columns }, (_, column) =>
      index === separatorIndex
        ? separatorFor(alignments[column] ?? 'none', widths[column] ?? 0)
        : (row[column] ?? '').padEnd(
            (widths[column] ?? 0) +
              ((row[column] ?? '').length - widthOf(row[column] ?? '')),
          ),
    )

    return `${indent}| ${cells.join(' | ')} |`
  })
}

/**
 * Every table in `lines` that is not already aligned, with the replacement
 * text. Returns nothing for a conforming document, so both callers can treat
 * an empty result as "nothing to do".
 */
const misalignedTables = (lines: readonly string[]): readonly Misaligned[] =>
  tableBlocks(lines)
    .filter(isTable)
    .map((block) => ({ block, aligned: alignBlock(block) }))
    .filter(({ block, aligned }) =>
      block.lines.some((line, index) => line !== aligned[index]),
    )

/** A fence opener or closer, which the scan must not look inside. */
const FENCE = /^\s*(```|~~~)/

type FenceState = {
  /** The fence marker currently open, or empty outside a fence. */
  readonly marker: string
  readonly lines: readonly string[]
}

type RuleParams = {
  readonly lines: readonly string[]
}

type Violation = {
  readonly lineNumber: number
  readonly detail: string
  readonly context: string
  readonly fixInfo: {
    readonly lineNumber: number
    readonly editColumn: number
    readonly deleteCount: number
    readonly insertText: string
  }
}

/**
 * Lines outside fenced blocks, with the lines inside them blanked rather than
 * removed so that every index still matches the file. A table drawn inside a
 * fence is an ASCII diagram or sample source, and is not this rule's business.
 */
const outsideFences = (lines: readonly string[]): readonly string[] =>
  lines.reduce<FenceState>(
    (state, line) => {
      const fence = line.match(FENCE)

      return state.marker !== ''
        ? {
            marker:
              fence && line.trim().startsWith(state.marker) ? '' : state.marker,
            lines: [...state.lines, ''],
          }
        : fence
          ? { marker: fence[1] ?? '', lines: [...state.lines, ''] }
          : { marker: '', lines: [...state.lines, line] }
    },
    { marker: '', lines: [] },
  ).lines

export default {
  names: ['table-alignment'],
  description: 'Table columns are padded so they line up in the source',
  tags: ['tables', 'whitespace'],
  parser: 'none' as const,
  function: (params: RuleParams, onError: (error: Violation) => void): void => {
    const lines = outsideFences(params.lines)

    const violations = misalignedTables(lines).flatMap(({ block, aligned }) =>
      block.lines.flatMap((line, offset) =>
        line === aligned[offset]
          ? []
          : [
              {
                lineNumber: block.start + offset + 1,
                detail:
                  'pad the cells so the pipes line up; scripts/reflow.ts does this',
                context: line.trim(),
                fixInfo: {
                  lineNumber: block.start + offset + 1,
                  editColumn: 1,
                  deleteCount: line.length,
                  insertText: aligned[offset] ?? line,
                },
              },
            ],
      ),
    )

    for (const violation of violations) {
      onError(violation)
    }
  },
}
