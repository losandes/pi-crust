/**
 * Minimal, dependency-free markdown → HTML for the compiled prompt panels.
 *
 * Safety model: ALL input is HTML-escaped before any tags are produced, so
 * the only HTML in the output is what this module writes. No raw-HTML
 * passthrough, links restricted to http(s).
 *
 * Supported: #–#### headings, fenced code blocks, inline code, bold, links,
 * unordered/ordered lists, blockquotes, horizontal rules, paragraphs
 * (pre-wrap preserves intra-paragraph line breaks).
 */

import { escapeHtml, highlightJsonText } from './highlight'

/** Bold + links, applied only OUTSIDE inline-code spans. */
function inline(escaped: string): string {
  const parts = escaped.split(/(`[^`\n]+`)/g)
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return `<code>${part.slice(1, -1)}</code>`
      return part
        .replaceAll(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
        .replaceAll(
          /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g,
          '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
        )
    })
    .join('')
}

/** `| --- | :--: | ---: |` and its variants, with or without edge pipes. */
const DELIMITER = /^\s*\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/

/**
 * A table begins where a row is followed by a delimiter row.
 *
 * Both conditions are needed. Prose contains pipes often enough — a shell
 * pipeline, an either/or — and promoting the first one to a table header
 * would eat the paragraph that followed it.
 */
const isTableStart = (line: string, next: string | undefined): boolean =>
  line.includes('|') && next !== undefined && DELIMITER.test(next)

/** As many cells as the header has, blanks where the row ran out. */
const padded = (cells: readonly string[], width: number): readonly string[] =>
  cells.length >= width
    ? cells
    : [...cells, ...Array.from({ length: width - cells.length }, () => '')]

/**
 * Cells of one row, splitting only on pipes that divide columns.
 *
 * `\|` is a literal pipe, which is the only way to write one inside a cell,
 * and a design document that documents a union type uses it — splitting on
 * it turned a three-column row into eight and the table came apart below
 * that line. Found by rendering every document in the trace, not by the
 * unit tests, which is why that sweep is part of the work.
 */
const cellsOf = (line: string): readonly string[] => {
  const text = line.trim()
  // Split on the pipes that divide columns — every pipe an escape does not
  // precede — then unescape the ones that survived inside a cell.
  const cells = text
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replaceAll('\\|', '|').trim())
  // The pipes at either edge are optional delimiters, not empty columns —
  // but only when they are actually at the edge.
  const withoutLeading = text.startsWith('|') ? cells.slice(1) : cells
  return /(^|[^\\])\|$/.test(text)
    ? withoutLeading.slice(0, -1)
    : withoutLeading
}

/** Per-column alignment, as the delimiter row's colons declare it. */
const alignments = (delimiter: string): readonly string[] =>
  cellsOf(delimiter).map((cell) => {
    const left = cell.startsWith(':')
    const right = cell.endsWith(':')
    if (left && right) return 'center'
    return right ? 'right' : 'left'
  })

/**
 * One row. Cells are escaped before any inline formatting, like every other
 * block here, so a table cannot be the way a document injects markup.
 */
const row = (
  cells: readonly string[],
  aligns: readonly string[],
  tag: 'th' | 'td',
): string =>
  /*
   * Padded to the header's width, never truncated.
   *
   * A trailing empty cell is indistinguishable from the optional closing
   * pipe once the row is trimmed, so `1 | ` arrives one cell short and the
   * column it belonged to would silently shift left — which is worse than a
   * blank, because the row still looks plausible. Extra cells are kept for
   * the same reason: a visibly ragged table beats a quietly dropped value.
   */
  `<tr>${padded(cells, aligns.length)
    .map((cell, column) => {
      // The alignment is one of three literals this module chose, never
      // anything from the document.
      const align = aligns[column] ?? 'left'
      const style = align === 'left' ? '' : ` style="text-align:${align}"`
      return `<${tag}${style}>${inline(escapeHtml(cell))}</${tag}>`
    })
    .join('')}</tr>`

/** A parsed block: the HTML it renders to, and the line after it. */
type TBlock = Readonly<{ html: string | undefined; next: number }>

const FENCE_OPEN = /^\s*```(\w*)/
const FENCE_ANY = /^\s*```/
const HEADING = /^(#{1,4})\s+(.*)$/
const RULE = /^\s*(---+|\*\*\*+)\s*$/
const QUOTE = /^\s*>\s?/
const UL_ITEM = /^\s*[-*]\s+/
const OL_ITEM = /^\s*\d+\.\s+/

/** The first line at or after `from` that the predicate rejects. */
const endOfRun = (
  lines: readonly string[],
  from: number,
  holds: (line: string) => boolean,
): number => {
  let end = from
  while (end < lines.length && holds(lines[end] ?? '')) end += 1
  return end
}

/**
 * Does a block begin here?
 *
 * This is the same dispatch `blockAt` performs, asked as a question, and it
 * is what ends a paragraph: a paragraph runs until something else starts.
 */
const startsBlock = (lines: readonly string[], index: number): boolean => {
  const raw = lines[index] ?? ''
  return (
    FENCE_OPEN.test(raw) ||
    HEADING.test(raw) ||
    isTableStart(raw, lines[index + 1]) ||
    RULE.test(raw) ||
    QUOTE.test(raw) ||
    UL_ITEM.test(raw) ||
    OL_ITEM.test(raw) ||
    raw.trim() === ''
  )
}

/**
 * The block beginning at `index`, and where the next one starts.
 *
 * Each branch reads its own lines and reports how many it consumed, which is
 * what the single `i` of the old loop was doing between `continue`s.
 */
const blockAt = (lines: readonly string[], index: number): TBlock => {
  const raw = lines[index] ?? ''

  // Fenced code block — verbatim until the closing fence. json fences get
  // syntax highlighting (the Report contract in every user.md is one).
  const fence = FENCE_OPEN.exec(raw)
  if (fence) {
    const end = endOfRun(lines, index + 1, (line) => !FENCE_ANY.test(line))
    const text = lines.slice(index + 1, end).join('\n')
    const body =
      (fence[1] ?? '').toLowerCase() === 'json'
        ? highlightJsonText(text)
        : escapeHtml(text)
    // One past the closing fence, which at end of input is one past the end.
    return {
      html: `<pre class="md-code"><code>${body}</code></pre>`,
      next: end + 1,
    }
  }

  const heading = HEADING.exec(raw)
  if (heading?.[1] && heading[2] !== undefined) {
    const level = heading[1].length
    return {
      html: `<h${level}>${inline(escapeHtml(heading[2]))}</h${level}>`,
      next: index + 1,
    }
  }

  /*
   * A pipe table, which the architects produce constantly — a comparison
   * of candidate approaches is a table, and rendered as paragraphs it was
   * a wall of pipes that had to be read character by character.
   *
   * The delimiter row is what proves it is a table rather than prose that
   * happens to contain a pipe, which is why detection looks ahead rather
   * than triggering on the first row.
   */
  if (isTableStart(raw, lines[index + 1])) {
    const aligns = alignments(lines[index + 1] ?? '')
    const header = cellsOf(raw)
    const from = index + 2
    const end = endOfRun(lines, from, (line) => line.includes('|'))
    const body = lines
      .slice(from, end)
      .map((line) => row(cellsOf(line), aligns, 'td'))
    return {
      html:
        `<table class="md-table"><thead>${row(header, aligns, 'th')}</thead>` +
        `<tbody>${body.join('')}</tbody></table>`,
      next: end,
    }
  }

  if (RULE.test(raw)) return { html: '<hr>', next: index + 1 }

  if (QUOTE.test(raw)) {
    const end = endOfRun(lines, index, (line) => QUOTE.test(line))
    const quote = lines
      .slice(index, end)
      .map((line) => inline(escapeHtml(line.replace(QUOTE, ''))))
    return { html: `<blockquote>${quote.join('\n')}</blockquote>`, next: end }
  }

  const ulItem = UL_ITEM.test(raw)
  if (ulItem || OL_ITEM.test(raw)) {
    const tag = ulItem ? 'ul' : 'ol'
    const marker = ulItem ? UL_ITEM : OL_ITEM
    const end = endOfRun(lines, index, (line) => marker.test(line))
    const items = lines
      .slice(index, end)
      .map((line) => `<li>${inline(escapeHtml(line.replace(marker, '')))}</li>`)
    return { html: `<${tag}>${items.join('')}</${tag}>`, next: end }
  }

  // A blank line closes whatever came before it and renders nothing itself.
  if (raw.trim() === '') return { html: undefined, next: index + 1 }

  // Prose, up to whatever starts next. The lookahead a table needs is why
  // this asks about the position rather than the line.
  let paragraphEnd = index + 1
  while (paragraphEnd < lines.length && !startsBlock(lines, paragraphEnd)) {
    paragraphEnd += 1
  }
  const paragraph = lines
    .slice(index, paragraphEnd)
    .map((line) => inline(escapeHtml(line)))
  return { html: `<p>${paragraph.join('\n')}</p>`, next: paragraphEnd }
}

/** Every block of the document, in order. */
function* blocksOf(lines: readonly string[]): Generator<string> {
  let index = 0
  while (index < lines.length) {
    const block = blockAt(lines, index)
    if (block.html !== undefined) yield block.html
    index = block.next
  }
}

export function renderMarkdown(src: string): string {
  return [...blocksOf(src.replaceAll('\r\n', '\n').split('\n'))].join('\n')
}
