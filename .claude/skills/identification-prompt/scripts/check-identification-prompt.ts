#!/usr/bin/env bun
/**
 * Blocking checker for a prompt written for pi-crust's Identify Activity.
 *
 * Usage:
 *   bun <skill>/scripts/check-identification-prompt.ts <path>...
 *   pbpaste | bun <skill>/scripts/check-identification-prompt.ts -
 *
 * Exit codes: 0 = clean, 1 = violations found, 2 = usage/environment error
 *
 * Identify copies the prompt verbatim into its `## Request` section, and the
 * gh-issue Activity copies that document into the GitHub issue body. A path the
 * prompt cites is therefore read twice: once by an agent that may run on another
 * checkout, and later by a person reading the issue on GitHub. Both read
 * committed content only. This checks every backticked path the prompt cites:
 *
 * - it exists in this working tree
 * - it is not gitignored, because ignored content never reaches either reader
 * - it is tracked by git, because an untracked file exists only on this machine
 * - a cited line number is within the file
 *
 * It warns, without failing, when a cited file has uncommitted changes, since
 * its line numbers may not match the revision the issue will be read against,
 * and when the prompt is more than one paragraph, which is harder to paste.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

/*
 * The repository the prompt is about, not the one holding this script. The
 * skill may be copied into a user's own skills directory, where a path derived
 * from this file would point outside every repository it serves.
 */
const REPO_ROOT = (() => {
  const override = process.env.MY_WORKSPACE
  if (override !== undefined && override !== '') return resolve(override)
  const top = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  })
  const root = top.status === 0 ? top.stdout.trim() : ''
  return root === '' ? process.cwd() : root
})()

/*
 * A backticked token is treated as a path when its last segment has an
 * extension or it ends in `/`. That excludes refs such as `origin/HEAD` and
 * placeholders such as `specs/<name>.md`, which are not claims that a file exists.
 */
const PATH_TOKEN =
  /^(?<path>[\w.@~-][\w.@~/-]*(?:\.[\w-]+|\/))(?::(?<from>\d+)(?:-(?<to>\d+))?)?$/

type TCitation = Readonly<{
  token: string
  path: string
  line: number | undefined
}>

type TFinding = Readonly<{
  token: string
  severity: 'violation' | 'warning'
  rule: string
  message: string
}>

const git = (
  args: readonly string[],
): Readonly<{ status: number; stdout: string }> => {
  const result = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' })
  return { status: result.status ?? 2, stdout: result.stdout ?? '' }
}

const citations = (text: string): readonly TCitation[] =>
  [...text.matchAll(/`([^`\n]+)`/g)].flatMap((match) => {
    const token = match[1] ?? ''
    const parsed = PATH_TOKEN.exec(token)
    if (parsed?.groups === undefined) return []
    const path = parsed.groups.path ?? ''
    if (!path.includes('/') && !path.includes('.')) return []
    const to = parsed.groups.to ?? parsed.groups.from
    return [{ token, path, line: to === undefined ? undefined : Number(to) }]
  })

const lineCount = (absolute: string): number =>
  readFileSync(absolute, 'utf8').replace(/\n$/, '').split('\n').length

const findingsFor = (citation: TCitation): readonly TFinding[] => {
  const absolute = join(REPO_ROOT, citation.path)
  const finding = (
    severity: TFinding['severity'],
    rule: string,
    message: string,
  ): TFinding => ({ token: citation.token, severity, rule, message })

  if (git(['check-ignore', '-q', citation.path]).status === 0) {
    return [
      finding(
        'violation',
        'gitignored',
        'ignored content never reaches the agent or the issue reader; quote what matters or cite a committed source',
      ),
    ]
  }
  if (!existsSync(absolute)) {
    return [
      finding(
        'violation',
        'missing',
        'no such path in this working tree; verify it before citing it',
      ),
    ]
  }
  if (git(['ls-files', '--error-unmatch', citation.path]).status !== 0) {
    return [
      finding(
        'violation',
        'untracked',
        'exists only on this machine; commit it or describe it without the path',
      ),
    ]
  }
  const isFile = statSync(absolute).isFile()
  const outOfRange =
    citation.line !== undefined &&
    isFile &&
    citation.line > lineCount(absolute)
  const dirty =
    isFile && git(['diff', '--quiet', 'HEAD', '--', citation.path]).status !== 0

  return [
    ...(outOfRange
      ? [
          finding(
            'violation',
            'line-out-of-range',
            `the file has ${lineCount(absolute)} lines`,
          ),
        ]
      : []),
    ...(dirty
      ? [
          finding(
            'warning',
            'uncommitted-changes',
            'line numbers may not match the revision the issue is read against',
          ),
        ]
      : []),
  ]
}

const paragraphs = (text: string): number =>
  text
    .replace(/(^|\n)(`{3,}|~{3,})[\s\S]*?\n\2/g, '$1')
    .split(/\n\s*\n/)
    .filter((block) => block.trim() !== '').length

const check = (label: string, text: string): number => {
  const cited = citations(text)
  const findings = cited.flatMap(findingsFor)
  const violations = findings.filter((one) => one.severity === 'violation')
  const blocks = paragraphs(text)

  for (const one of findings) {
    console.log(`  ${label}: \`${one.token}\``)
    console.log(`      [${one.severity}: ${one.rule}] ${one.message}`)
  }
  if (blocks > 1) {
    console.log(
      `  ${label}: [warning: paragraphs] ${blocks} paragraphs; one is easier to paste, if it loses nothing`,
    )
  }
  console.log(
    `check-identification-prompt: ${label} citations=${cited.length} violations=${violations.length} warnings=${findings.length - violations.length + (blocks > 1 ? 1 : 0)}`,
  )
  return violations.length
}

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error(
    'usage: check-identification-prompt.ts <path>... | check-identification-prompt.ts -',
  )
  process.exit(2)
}

const missing = args.filter((arg) => arg !== '-' && !existsSync(arg))
if (missing.length > 0) {
  console.error(`error: no such file: ${missing.join(', ')}`)
  process.exit(2)
}

const total = args
  .map((arg) =>
    arg === '-'
      ? check('stdin', readFileSync(0, 'utf8'))
      : check(arg, readFileSync(arg, 'utf8')),
  )
  .reduce((sum, count) => sum + count, 0)

process.exit(total > 0 ? 1 : 0)
