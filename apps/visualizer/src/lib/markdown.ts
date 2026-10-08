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
const padded = (
  cells: readonly string[],
  width: number,
): readonly string[] =>
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
  const cells: string[] = []
  let current = ''
  let index = 0
  while (index < text.length) {
    const char = text[index]
    if (char === '\\' && text[index + 1] === '|') {
      current += '|'
      index += 2
      continue
    }
    if (char === '|') {
      cells.push(current.trim())
      current = ''
      index += 1
      continue
    }
    current += char
    index += 1
  }
  cells.push(current.trim())
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

export function renderMarkdown(src: string): string {
  const lines = src.replaceAll('\r\n', '\n').split('\n')
  const out: string[] = []
  let i = 0

  const paragraph: string[] = []
  function flushParagraph() {
    if (paragraph.length) {
      out.push(`<p>${paragraph.map(inline).join('\n')}</p>`)
      paragraph.length = 0
    }
  }

  while (i < lines.length) {
    const raw = lines[i] ?? ''
    const line = escapeHtml(raw)

    // Fenced code block — verbatim until the closing fence. json fences get
    // syntax highlighting (the Report contract in every user.md is one).
    const fence = /^\s*```(\w*)/.exec(raw)
    if (fence) {
      flushParagraph()
      const code: string[] = []
      i += 1
      while (i < lines.length && !/^\s*```/.test(lines[i] ?? '')) {
        code.push(lines[i] ?? '')
        i += 1
      }
      i += 1
      const text = code.join('\n')
      const body =
        (fence[1] ?? '').toLowerCase() === 'json' ? highlightJsonText(text) : escapeHtml(text)
      out.push(`<pre class="md-code"><code>${body}</code></pre>`)
      continue
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(raw)
    if (heading?.[1] && heading[2] !== undefined) {
      flushParagraph()
      const level = heading[1].length
      out.push(`<h${level}>${inline(escapeHtml(heading[2]))}</h${level}>`)
      i += 1
      continue
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
    if (isTableStart(raw, lines[i + 1])) {
      flushParagraph()
      const aligns = alignments(lines[i + 1] ?? '')
      const header = cellsOf(raw)
      i += 2
      const body: string[] = []
      while (i < lines.length && (lines[i] ?? '').includes('|')) {
        body.push(row(cellsOf(lines[i] ?? ''), aligns, 'td'))
        i += 1
      }
      out.push(
        `<table class="md-table"><thead>${row(header, aligns, 'th')}</thead>` +
          `<tbody>${body.join('')}</tbody></table>`,
      )
      continue
    }

    if (/^\s*(---+|\*\*\*+)\s*$/.test(raw)) {
      flushParagraph()
      out.push('<hr>')
      i += 1
      continue
    }

    if (/^\s*&gt;\s?/.test(line)) {
      flushParagraph()
      const quote: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i] ?? '')) {
        quote.push(inline(escapeHtml((lines[i] ?? '').replace(/^\s*>\s?/, ''))))
        i += 1
      }
      out.push(`<blockquote>${quote.join('\n')}</blockquote>`)
      continue
    }

    const ulItem = /^\s*[-*]\s+/.test(raw)
    const olItem = /^\s*\d+\.\s+/.test(raw)
    if (ulItem || olItem) {
      flushParagraph()
      const tag = ulItem ? 'ul' : 'ol'
      const marker = ulItem ? /^\s*[-*]\s+/ : /^\s*\d+\.\s+/
      const items: string[] = []
      while (i < lines.length && marker.test(lines[i] ?? '')) {
        items.push(`<li>${inline(escapeHtml((lines[i] ?? '').replace(marker, '')))}</li>`)
        i += 1
      }
      out.push(`<${tag}>${items.join('')}</${tag}>`)
      continue
    }

    if (raw.trim() === '') {
      flushParagraph()
      i += 1
      continue
    }

    paragraph.push(line)
    i += 1
  }
  flushParagraph()
  return out.join('\n')
}
