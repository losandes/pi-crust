/**
 * Custom markdownlint rule: a paragraph is one line.
 *
 * markdownlint has no rule for this, because the convention it enforces is the
 * inverse of MD013 rather than a variation on it. Everything else in
 * `adr/conventions/format-markdown.md` is a built-in rule, configured in
 * `.markdownlint-cli2.jsonc` beside this file.
 *
 * No `fixInfo`, deliberately, unlike `table-alignment`. Joining lines means
 * deciding what is a paragraph and what is deliberately two blocks, and a
 * wrong automatic join silently merges them. `scripts/reflow.ts` does it
 * where a person can read the result.
 *
 * Detection is structural, not textual: micromark reports the source span of
 * every block, so a paragraph or heading whose span covers more than one line
 * was wrapped by hand. Tables, fenced code, HTML blocks, and front matter are
 * other token types and are never considered.
 *
 * A trailing double space or backslash is a hard wrap spelled differently, so
 * both are reported here too. They are invisible in a diff, which is why they
 * get their own message rather than being folded into the span check.
 */

/** Blocks whose content is prose, and so must occupy a single source line. */
const PROSE_BLOCKS: ReadonlySet<string> = new Set(['paragraph', 'setextHeading'])

type Token = {
  readonly type: string
  readonly startLine: number
  readonly endLine: number
  readonly children?: readonly Token[]
}

type RuleParams = {
  readonly lines: readonly string[]
  readonly parsers: { readonly micromark: { readonly tokens: readonly Token[] } }
}

type Violation = {
  readonly lineNumber: number
  readonly detail: string
  readonly context: string
}

/**
 * micromark tokens form a tree, and `params.parsers.micromark.tokens` is only
 * its top level — a paragraph sits inside a `content` token, and a hard break
 * sits inside the paragraph. Filtering the top level alone matches nothing and
 * reports a clean file, which is the failure this flatten exists to avoid.
 */
const flatten = (tokens: readonly Token[]): readonly Token[] =>
  tokens.flatMap((token) => [token, ...flatten(token.children ?? [])])

export default {
  names: ['no-hard-wrap'],
  description: 'A paragraph is one line; let the reader\u2019s editor wrap it',
  tags: ['whitespace', 'line_length'],
  parser: 'micromark' as const,
  function: (params: RuleParams, onError: (error: Violation) => void): void => {
    const tokens = flatten(params.parsers.micromark.tokens)

    for (const token of tokens.filter((t) => PROSE_BLOCKS.has(t.type))) {
      if (token.endLine > token.startLine) {
        onError({
          // micromark's line numbers are 1-based, so `detail` quotes them as
          // they are. `lineNumber` deliberately points one line in: the break
          // being reported sits at the END of startLine, so the line that
          // should not exist is the one after it, and that is where an editor
          // jumping to the finding should land.
          lineNumber: token.startLine + 1,
          detail: `this block occupies lines ${token.startLine}-${token.endLine}; join them into one line`,
          context: params.lines[token.startLine] ?? '',
        })
      }
    }

    // `hardBreakTrailing` is two or more spaces at end of line;
    // `hardBreakEscape` is a trailing backslash. Both force a break inside a
    // paragraph, which the record bans outright.
    for (const token of tokens.filter(
      (t) => t.type === 'hardBreakTrailing' || t.type === 'hardBreakEscape',
    )) {
      onError({
        lineNumber: token.startLine,
        detail:
          token.type === 'hardBreakEscape'
            ? 'a trailing backslash forces a break inside a paragraph; start a new block'
            : 'a trailing double space forces a break inside a paragraph; start a new block',
        context: params.lines[token.startLine - 1] ?? '',
      })
    }
  },
}
