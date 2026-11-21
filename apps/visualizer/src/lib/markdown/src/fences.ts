/**
 * Splitting streamed narration into prose and fenced code.
 *
 * Narration is speech, not a document: an agent thinks in sentences and
 * occasionally quotes a command, a diff or a JSON payload. Rendering the whole
 * thing as markdown would be wrong twice over — it sits inside a button, where
 * an anchor is invalid HTML and unreachable by keyboard, and an agent's prose
 * is full of asterisks and underscores it did not mean as emphasis.
 *
 * So this understands exactly one construct: the fence.
 *
 * The last fence may be OPEN. Narration arrives a token at a time, so at the
 * moment of rendering the model has often written ```ts and three lines and
 * not yet the closing fence. Waiting for the close would make code appear as
 * unstyled prose and then jump — worse than showing it as what it already
 * plainly is. An open fence is a code block, flagged so the view can say so.
 */

import { safeParseSettlement } from '@typedefs'

export type TSegment = Readonly<{
  kind: 'prose' | 'code'
  text: string
  /** The info string of a fence, lowercased: `ts`, `json`, `''` when bare. */
  language: string
  /** True when the closing fence has not arrived yet. Always false for prose. */
  open: boolean
}>

const FENCE = /^\s*```(\S*)\s*$/

/**
 * Trailing blank lines are dropped from code, leading and trailing blank lines
 * from prose: a fence always sits on its own line, so every segment would
 * otherwise inherit the newline that belonged to the delimiter.
 */
const trimEdges = (lines: readonly string[]): readonly string[] => {
  let start = 0
  let end = lines.length
  while (start < end && (lines[start] ?? '').trim() === '') start += 1
  while (end > start && (lines[end - 1] ?? '').trim() === '') end -= 1
  return lines.slice(start, end)
}

const segment = (
  kind: TSegment['kind'],
  lines: readonly string[],
  language: string,
  open: boolean,
): readonly TSegment[] => {
  const kept = trimEdges(lines)
  if (kept.length === 0) return []
  return [{ kind, text: kept.join('\n'), language, open }]
}

/**
 * Split text into alternating prose and code segments.
 *
 * Returns a single prose segment when there is no fence at all, which is the
 * overwhelmingly common case and the one worth being cheap.
 */
export const splitFences = (source: string): readonly TSegment[] => {
  const lines = source.replaceAll('\r\n', '\n').split('\n')

  /*
   * Every fence line, in order. They alternate: the first opens, the second
   * closes, and the one after that opens again — which is what the old
   * `language === undefined` flag was tracking one line at a time.
   */
  const fences = lines.flatMap((line, index) => {
    const fence = FENCE.exec(line)
    return fence === null
      ? []
      : [{ index, language: (fence[1] ?? '').toLowerCase() }]
  })

  // The regions between them, including the one before the first fence and
  // the one after the last — either of which may be empty.
  const starts = [0, ...fences.map((fence) => fence.index + 1)]
  const ends = [...fences.map((fence) => fence.index), lines.length]

  return starts.flatMap((start, region) => {
    const body = lines.slice(start, ends[region] ?? lines.length)
    if (region % 2 === 0) return segment('prose', body, '', false)
    // An unterminated block is the last region, and says so.
    const open = region === starts.length - 1
    return segment('code', body, fences[region - 1]?.language ?? '', open)
  })
}

/** True when any part of this text is fenced — lets a caller skip the work. */
export const hasFence = (source: string): boolean => source.includes('```')

/**
 * Where a complete JSON value starts and ends, scanning from one line.
 *
 * Brace counting alone is not enough: a brace inside a string literal, and an
 * escaped quote inside that string, both lie about the depth. So this tracks
 * whether it is inside a string and whether the previous character escaped
 * the next one — the three states a JSON scanner actually needs.
 *
 * Returns the end INDEX in `source`, or -1 when the value never closes, which
 * is the ordinary state of narration still being streamed.
 */
const jsonEnd = (source: string, from: number): number => {
  const opener = source[from]
  const closer = opener === '[' ? ']' : '}'
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = from; index < source.length; index += 1) {
    const char = source[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\' && inString) {
      escaped = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (char === opener) depth += 1
    else if (char === closer) {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

/**
 * Does this text begin a JSON object convincingly enough to render as one?
 *
 * Needed because the complete-value test cannot be the only one. Narration
 * is capped, and every bare report in the trace hit that cap — so the value
 * never closes and `JSON.parse` never succeeds, which left the exact blocks
 * this exists for rendering as a wall of prose.
 *
 * The test stays strict about SHAPE: an opening brace, then a quoted key,
 * then a colon. That is the one thing an agent's prose about code reliably
 * is not — `{ timeout: 30 }` has no quoted key, and a sentence containing a
 * brace has no colon after one.
 */
const JSON_HEAD = /^[{[]\s*(\{\s*)?"[^"]+"\s*:/

/**
 * The first JSON object or array in this text, as a range.
 *
 * Two ways to qualify, and the difference is recorded rather than hidden:
 *
 * - it CLOSES and parses — certain, rendered as a finished block
 * - it does not close, but begins unmistakably — rendered as an OPEN block,
 *   the same dashed treatment an unterminated fence already gets, because
 *   it is the same situation: more was coming and we do not have it
 *
 * Parsing is still the test wherever parsing is possible. An agent's prose
 * is full of braces, and only a parser can tell a payload from a sentence.
 */
const findJson = (
  source: string,
): Readonly<{ start: number; end: number; open: boolean }> | undefined => {
  const match = /(^|\n)[ \t]*[{[]/.exec(source)
  if (match === null) return undefined
  const start = match.index + match[0].length - 1
  const end = jsonEnd(source, start)
  if (end === -1) {
    return JSON_HEAD.test(source.slice(start))
      ? { start, end: source.length, open: true }
      : undefined
  }
  const candidate = source.slice(start, end + 1)
  const settled = safeParseSettlement(() => JSON.parse(candidate) as unknown)
  // Text that does not parse is prose, whatever its braces suggested.
  if (settled.status === 'error') return undefined
  // A bare string or number is not a block of code, whatever it parsed as.
  if (typeof settled.data !== 'object' || settled.data === null) {
    return undefined
  }
  return { start, end: end + 1, open: false }
}

/**
 * The same split, plus JSON an agent forgot to fence.
 *
 * Agents paste their Report envelope into narration bare more often than they
 * fence it — nine of the first few hundred narration blocks recorded here, and
 * every one of them the final message of a turn, which is exactly where a
 * reader is looking. Rendered as prose it is a wall of unwrapped punctuation.
 *
 * Only segments the fence splitter already called PROSE are examined, so an
 * explicit fence always wins and nothing inside one is re-examined.
 */
export const splitFencesAndJson = (source: string): readonly TSegment[] =>
  splitFences(source).flatMap((part) =>
    part.kind === 'code' ? [part] : proseWithJson(part.text),
  )

/*
 * Every prose piece goes back through `segment`, which drops an empty one.
 * Without that, text ENDING in JSON — the common case, since the envelope is
 * the last thing a turn says — left an empty prose block after the code.
 */
const proseWithJson = (text: string): readonly TSegment[] => {
  const found = findJson(text)
  if (found === undefined) return segment('prose', text.split('\n'), '', false)
  return [
    ...segment('prose', text.slice(0, found.start).split('\n'), '', false),
    {
      kind: 'code',
      text: text.slice(found.start, found.end),
      language: 'json',
      open: found.open,
    },
    // Recursive, because a turn can paste two objects with a sentence
    // between them, and stopping at the first would leave the second bare.
    ...proseWithJson(text.slice(found.end)),
  ]
}

/** True when this text contains a fence OR JSON nobody fenced. */
export const hasCode = (source: string): boolean =>
  hasFence(source) || findJson(source) !== undefined
