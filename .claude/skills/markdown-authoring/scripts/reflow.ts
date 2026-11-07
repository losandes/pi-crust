#!/usr/bin/env bun
/**
 * Join hard-wrapped prose back into one-line paragraphs.
 *
 * The one repair `markdownlint-cli2 --fix` cannot make. It handles blank
 * lines, list markers, whitespace, and table padding, because every rule
 * behind those carries `fixInfo`. `no-hard-wrap` deliberately does not:
 * joining lines means deciding what is a paragraph and what is two blocks,
 * and a wrong automatic join silently merges them.
 *
 * The repair is shape, not content: the non-whitespace characters of a file
 * are identical before and after, which is the cheap proof that lines were
 * joined and nothing was rewritten.
 *
 * What is never touched:
 *
 * - anything inside a fenced block, including diagrams and code
 * - headings, block quotes, and horizontal rules
 * - front matter, whose line breaks are structural
 * - a line break before a list item, which starts a new block
 *
 * What is joined: the continuation lines of a paragraph, and of a single list
 * item. Indentation of the first line is preserved so nesting survives.
 *
 * Tables are left exactly as found, including their padding. `--fix` owns
 * that, and a second implementation here could disagree with the rule.
 *
 * Usage: bun scripts/reflow.ts <file>...   (writes in place, prints changes)
 *
 * Exit codes: 0 = done, 2 = usage error
 */

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const FENCE = /^\s*(```|~~~)/
const HEADING = /^\s{0,3}#{1,6}\s/
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+/
const TABLE = /^\s*\|/
const QUOTE = /^\s*>/
const THEMATIC_BREAK = /^\s*([-*_])(\s*\1){2,}\s*$/
const FRONTMATTER = /^---\s*$/
const FORCED_BREAK = /(\s\s|\\)$/

/** A line that must begin its own block rather than continue the last. */
const startsBlock = (line: string): boolean =>
  line.trim() === '' ||
  FENCE.test(line) ||
  HEADING.test(line) ||
  LIST_ITEM.test(line) ||
  TABLE.test(line) ||
  QUOTE.test(line) ||
  THEMATIC_BREAK.test(line)

type JoinState = {
  readonly out: readonly string[]
  /** The paragraph or list item being accumulated; empty when none is open. */
  readonly buffer: string
  /** The fence marker currently open, or empty outside a fence. */
  readonly fence: string
  readonly inFrontmatter: boolean
}

const flushed = (state: JoinState): readonly string[] =>
  state.buffer === '' ? state.out : [...state.out, state.buffer]

const joinLine = (state: JoinState, line: string, index: number): JoinState => {
  // Front matter is YAML, not prose, and its line breaks carry meaning.
  if (index === 0 && FRONTMATTER.test(line)) {
    return { ...state, out: [...state.out, line], inFrontmatter: true }
  }

  if (state.inFrontmatter) {
    return {
      ...state,
      out: [...state.out, line],
      inFrontmatter: !FRONTMATTER.test(line),
    }
  }

  const fence = line.match(FENCE)

  if (state.fence !== '') {
    return {
      ...state,
      out: [...state.out, line],
      fence: fence && line.trim().startsWith(state.fence) ? '' : state.fence,
    }
  }

  if (fence) {
    return {
      ...state,
      out: [...flushed(state), line],
      buffer: '',
      fence: fence[1] ?? '',
    }
  }

  if (startsBlock(line)) {
    // A list item may itself be wrapped, so it opens a buffer rather than
    // being emitted outright. Everything else stands alone.
    return LIST_ITEM.test(line)
      ? { ...state, out: flushed(state), buffer: line.trimEnd() }
      : { ...state, out: [...flushed(state), line], buffer: '' }
  }

  // A continuation line. A trailing double space or backslash is a forced
  // break spelled differently, and goes when the break it caused goes.
  return {
    ...state,
    buffer:
      state.buffer === ''
        ? line.trimEnd()
        : `${state.buffer.replace(FORCED_BREAK, '')} ${line.trim()}`,
  }
}

const joinParagraphs = (lines: readonly string[]): readonly string[] =>
  flushed(
    lines.reduce<JoinState>(joinLine, {
      out: [],
      buffer: '',
      fence: '',
      inFrontmatter: false,
    }),
  )

export const reflow = (text: string): string => {
  const body = joinParagraphs(text.split('\n')).join('\n')

  return body.endsWith('\n') ? body : `${body}\n`
}

type Change = {
  readonly path: string
  readonly before: number
  readonly after: number
}

const repair = (path: string): Change | undefined => {
  const before = readFileSync(path, 'utf8')
  const after = reflow(before)

  if (after === before) {
    return undefined
  }

  writeFileSync(path, after)

  return {
    path,
    before: before.split('\n').length,
    after: after.split('\n').length,
  }
}

const main = (argv: readonly string[]): void => {
  const paths = argv.filter((argument) => !argument.startsWith('-'))

  if (paths.length === 0) {
    console.error('usage: bun scripts/reflow.ts <file>...')
    process.exit(2)
  }

  // A missing path is a typo, and a stack trace would read as a broken
  // script rather than as the usage error it is.
  const missing = paths.filter(
    (path) => !existsSync(resolve(path)) || statSync(resolve(path)).isDirectory(),
  )

  if (missing.length > 0) {
    console.error(`error: not a readable file: ${missing.join(', ')}`)
    process.exit(2)
  }

  const changes = paths
    .map(repair)
    .filter((change): change is Change => change !== undefined)

  for (const change of changes) {
    console.log(`  ${change.path}: ${change.before} -> ${change.after} lines`)
  }

  console.log(`reflow: files=${paths.length} changed=${changes.length}`)
}

main(process.argv.slice(2))
