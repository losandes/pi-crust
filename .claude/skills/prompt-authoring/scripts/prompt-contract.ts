#!/usr/bin/env bun
/**
 * Contract analysis for pi-crust Activity prompts.
 *
 * Invoked by `check-prompt.sh`, which owns scope selection and extracts each
 * file's baseline from git. This script owns the analysis and the report.
 *
 * Usage:
 *   bun prompt-contract.ts --scope <label> --base <ref> --root <dir> \
 *     -- <current> <baseline-or-dash> [<current> <baseline-or-dash>...]
 *
 * `-` in a baseline position means the file is new, so only the structural
 * rules apply to it.
 *
 * Exit codes: 0 = clean, 1 = violations found, 2 = usage/environment error
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

type Finding = {
  readonly file: string
  readonly line: number
  readonly rule: string
  readonly message: string
}

type Pair = {
  readonly current: string
  readonly baseline: string | undefined
}

type Token = {
  readonly text: string
  readonly line: number
}

/*
 * The variables `execute-agent.ts` substitutes, and the only names a prompt
 * may use. `render` replaces the keys it is given and leaves every other
 * `{{name}}` in the text verbatim, so a misspelled or invented variable is
 * not an error at run time — the agent is simply handed the braces. Steering
 * is deliberately absent: it is appended to the user prompt rather than
 * rendered, so `{{steering}}` is a placeholder nothing fills.
 */
const SUPPORTED_VARIABLES = [
  'prompt',
  'previous_envelope',
  'previous_envelopes',
  'context_handoff_dir',
  'output_document',
  'skills',
  'changed_files',
  'change_base',
  'step_catalogue',
  'trust_stance',
] as const

/** Where that list is defined, and where this script verifies it. */
const VARIABLE_SOURCE =
  'runtime/domains/activities/src/use-cases/execute-agent.ts'

/** Where the envelope a Report example illustrates is actually declared. */
const ENVELOPE_SOURCE = 'runtime/lib/contracts/src/envelope.ts'

/** Sections every shipped Activity prompt has, by filename. */
const REQUIRED_SECTIONS: Readonly<Record<string, readonly string[]>> = {
  'system.md': ['## Purpose'],
  'user.md': ['## Variables', '## Intake', '## Task', '## Report'],
  'revise.md': ['## Variables', '## Intake', '## Task', '## Report'],
}

/**
 * A path a model copies, rather than one it reads as an analogy.
 *
 * Only inside a fenced json block: there, a path is a template for a field
 * the agent fills in, and a concrete one from the author's own repository
 * arrives in a Go project as a TypeScript filename. In prose the same path
 * is an illustration, and a concrete one is clearer than a placeholder.
 */
const SOURCE_EXTENSION = /\.(ts|tsx|js|jsx|py|go|rs|rb|java|kt|php|cs|swift)\b/

/** Directories never walked when collecting the test corpus. */
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
  '.venv',
  'temp-data',
])

const lineOf = (text: string, index: number): number =>
  text.slice(0, index).split('\n').length

const matchAll = (
  text: string,
  pattern: RegExp,
): readonly RegExpExecArray[] => [...text.matchAll(pattern)]

/** Every `{{...}}` in the file, including malformed ones. */
const placeholders = (text: string): readonly Token[] =>
  matchAll(text, /\{\{([^}]*)\}\}/g).map((match) => ({
    text: match[1] ?? '',
    line: lineOf(text, match.index ?? 0),
  }))

const headings = (text: string): readonly Token[] =>
  text
    .split('\n')
    .map((line, index) => ({ text: line.trim(), line: index + 1 }))
    .filter((entry) => entry.text.startsWith('## '))

/** Keys of every object in a ```json fence — the envelope's field names. */
const jsonKeys = (text: string): readonly Token[] =>
  matchAll(text, /```json\n([\s\S]*?)```/g).flatMap((fence) => {
    const body = fence[1] ?? ''
    const offset = (fence.index ?? 0) + '```json\n'.length
    return matchAll(body, /"([A-Za-z0-9_]+)"\s*:/g).map((key) => ({
      text: key[1] ?? '',
      line: lineOf(text, offset + (key.index ?? 0)),
    }))
  })

const jsonSourcePaths = (text: string): readonly Token[] =>
  matchAll(text, /```json\n([\s\S]*?)```/g).flatMap((fence) => {
    const firstLine = lineOf(text, fence.index ?? 0) + 1
    return (fence[1] ?? '')
      .split('\n')
      .map((line, index) => ({ text: line, line: firstLine + index }))
      .filter((token) => SOURCE_EXTENSION.test(token.text))
  })

/*
 * A backticked token is interface-shaped when dropping it changes what the
 * agent is told to read, run, or produce: a path, a filename, a schema name,
 * or a command. Ordinary prose in backticks is not matched, because an
 * optimization pass is allowed to rewrite prose and a checker that forbade it
 * could only be satisfied by reverting.
 */
const INTERFACE_SHAPED = [
  /\//,
  /\.(md|mdx|ts|tsx|js|json|ya?ml|sh|toml)$/,
  /^[A-Z][A-Za-z0-9]*(Output|Envelope|Input)$/,
  /^(bun|bunx|git|gh|npm|npx|just|uv|pytest|biome|cargo|make)\s/,
] as const

/*
 * What a token has to keep for it to count as surviving. A rewrite that
 * replaces `/usr/bin/*` with `/usr/bin/git` has not dropped the path, so the
 * comparison is made on the part before any glob.
 */
const stem = (token: string): string => token.split('*')[0] ?? token

const literals = (text: string): readonly Token[] =>
  matchAll(text, /`([^`\n]+)`/g)
    .map((match) => ({
      text: match[1] ?? '',
      line: lineOf(text, match.index ?? 0),
    }))
    .filter((token) =>
      INTERFACE_SHAPED.some((pattern) => pattern.test(token.text)),
    )
    .filter((token) => {
      // This advice illustrates command categories, not commands to execute.
      const examples =
        text
          .split('\n')
          [token.line - 1]?.match(
            /^- \*\*Make every change provable\.\*\* .*the one command that settles it: (.*), a specific assertion\./,
          )?.[1] ?? ''
      return !examples.includes(`\`${token.text}\``)
    })

const unique = (tokens: readonly Token[]): readonly Token[] => {
  const seen = new Set<string>()
  return tokens.filter((token) => {
    if (seen.has(token.text)) {
      return false
    }
    seen.add(token.text)
    return true
  })
}

const collectTestFiles = (root: string): readonly string[] => {
  if (!existsSync(root)) return []
  const entries = readdirSync(root)
  return entries.flatMap((entry) => {
    if (SKIPPED_DIRECTORIES.has(entry)) return []
    const path = join(root, entry)
    const stats = statSync(path)
    if (stats.isDirectory()) return collectTestFiles(path)
    return path.endsWith('.test.ts') || path.endsWith('.test.tsx') ? [path] : []
  })
}

/**
 * Everything the test suite asserts about prompt text, as one string.
 *
 * `request-capture.test.ts` and `gh-pull-request/prompt-content.test.ts` read
 * prompt files and assert on their contents, so a section those tests name is
 * part of the contract rather than a heading somebody liked. Searching the
 * corpus is how this script tells one from the other.
 */
const testCorpus = (root: string): string =>
  collectTestFiles(root)
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n')

const structuralFindings = (
  file: string,
  relativePath: string,
  text: string,
): readonly Finding[] => {
  const variableFindings = placeholders(text).flatMap(
    (token): readonly Finding[] => {
      if (!/^[a-z][a-z0-9_]*$/.test(token.text)) {
        return [
          {
            file: relativePath,
            line: token.line,
            rule: 'bad-placeholder',
            message:
              `{{${token.text}}} is not a substitutable name; render matches ` +
              '{{name}} exactly, so whitespace or punctuation inside the braces ' +
              'is left in the prompt the agent reads',
          },
        ]
      }
      if (!SUPPORTED_VARIABLES.some((name) => name === token.text)) {
        return [
          {
            file: relativePath,
            line: token.line,
            rule: 'unknown-variable',
            message:
              `{{${token.text}}} is not substituted by the harness; render ` +
              'leaves it verbatim in the prompt. Supported: ' +
              `${SUPPORTED_VARIABLES.join(', ')} (see ${VARIABLE_SOURCE})`,
          },
        ]
      }
      return []
    },
  )

  /*
   * Section rules apply to the prompts the harness ships and to a repository's
   * own overrides, not to `templates/stamp/prompt-engineering/`, which holds a
   * scaffold with angle-bracket blanks rather than a working prompt.
   */
  const isScaffold =
    file.includes('/templates/stamp/') ||
    file.includes('/prompt-engineering/example/')
  const basename = file.slice(file.lastIndexOf('/') + 1)
  const required = REQUIRED_SECTIONS[basename] ?? []
  const sectionFindings: readonly Finding[] = isScaffold
    ? []
    : required
        .filter((section) => !text.includes(`\n${section}`))
        .map((section) => ({
          file: relativePath,
          line: 1,
          rule: 'missing-section',
          message: `every ${basename} carries a '${section}' section; this one does not`,
        }))

  const reportIndex = text.indexOf('\n## Report')
  const reportFindings: readonly Finding[] =
    isScaffold ||
    (basename !== 'user.md' && basename !== 'revise.md') ||
    reportIndex === -1
      ? []
      : text.slice(reportIndex).includes('```json')
        ? []
        : [
            {
              file: relativePath,
              line: lineOf(text, reportIndex) + 1,
              rule: 'no-report-schema',
              message:
                'the Report section shows no ```json example; the agent is being ' +
                'asked for an envelope without being shown its fields',
            },
          ]

  const sourcePathFindings: readonly Finding[] =
    isScaffold || !relativePath.startsWith('runtime/prompt-engineering/')
      ? []
      : jsonSourcePaths(text).map((token) => ({
          file: relativePath,
          line: token.line,
          rule: 'source-path-in-json',
          message:
            'shipped JSON examples must use angle-bracket path placeholders, ' +
            'not source-file paths with a language extension',
        }))

  return [
    ...variableFindings,
    ...sectionFindings,
    ...reportFindings,
    ...sourcePathFindings,
  ]
}

const comparativeFindings = (
  relativePath: string,
  current: string,
  baseline: string,
  corpus: string,
  envelopeSource: string,
): readonly Finding[] => {
  const droppedVariables = unique(placeholders(baseline))
    .filter((token) => !current.includes(`{{${token.text}}}`))
    .map((token) => ({
      file: relativePath,
      line: token.line,
      rule: 'dropped-variable',
      message:
        `{{${token.text}}} was removed; the agent no longer receives it. ` +
        'Restore it, or state in your report why this prompt no longer needs it',
    }))

  /*
   * A field dropped from the Report example is a finding only while the
   * schema still declares it: that is the case where the agent stops
   * emitting something the envelope carries. Removing a field from the
   * prompt and from the schema together is a deliberate contract change, and
   * reporting it would make the rule unsatisfiable except by reverting.
   *
   * Where the schema is not on disk — a prompt being edited outside this
   * package — nothing can be ruled out, so every dropped field is reported
   * rather than silently accepted.
   */
  const currentKeys = new Set(jsonKeys(current).map((token) => token.text))
  const droppedKeys = unique(jsonKeys(baseline))
    .filter((token) => !currentKeys.has(token.text))
    .filter(
      (token) =>
        envelopeSource === '' ||
        new RegExp(
          `\\b${token.text}:\\s*(z\\.|[a-z][A-Za-z0-9_]*Schema\\b)`,
        ).test(envelopeSource),
    )
    .map((token) => ({
      file: relativePath,
      line: token.line,
      rule: 'dropped-envelope-field',
      message:
        envelopeSource === ''
          ? `the Report example no longer shows "${token.text}"; ${ENVELOPE_SOURCE} ` +
            'is not on disk, so whether the envelope still carries that field is unverified'
          : `the Report example no longer shows "${token.text}", but ` +
            `${ENVELOPE_SOURCE} still declares it; the agent will stop emitting a ` +
            'field the envelope carries. Remove it from the schema too, or restore it',
    }))

  const droppedLiterals = unique(literals(baseline))
    .filter((token) => !current.includes(stem(token.text)))
    .filter((token) => {
      // The shell advice's binary path is a forbidden example, not a command.
      const baselineLine = baseline.split('\n')[token.line - 1] ?? ''
      const generalizedShellExample =
        baselineLine.startsWith(
          "- You inherit the operator's shell environment",
        ) &&
        token.text.startsWith('/usr/bin/') &&
        current.includes(
          'never hunt for a binary or fall back to an absolute `/usr/bin/*` path.',
        )
      return !generalizedShellExample
    })
    .map((token) => ({
      file: relativePath,
      line: token.line,
      rule: 'dropped-literal',
      message:
        `\`${token.text}\` was removed; paths, filenames, schema names and ` +
        'commands are part of the execution contract, not wording',
    }))

  const currentHeadings = new Set(headings(current).map((token) => token.text))
  const droppedSections = unique(headings(baseline))
    .filter((token) => !currentHeadings.has(token.text))
    .filter((token) => corpus.includes(token.text.replace(/^##\s+/, '')))
    .map((token) => ({
      file: relativePath,
      line: token.line,
      rule: 'dropped-asserted-section',
      message:
        `'${token.text}' was removed and a test asserts that text; run the ` +
        'prompt tests, and change the test only when the contract itself changed',
    }))

  return [
    ...droppedVariables,
    ...droppedKeys,
    ...droppedLiterals,
    ...droppedSections,
  ]
}

const parseArguments = (
  argv: readonly string[],
): {
  readonly scope: string
  readonly base: string
  readonly root: string
  readonly pairs: readonly Pair[]
} => {
  const separator = argv.indexOf('--')
  const flags = separator === -1 ? argv : argv.slice(0, separator)
  const rest = separator === -1 ? [] : argv.slice(separator + 1)
  const flagValue = (name: string): string => {
    const index = flags.indexOf(name)
    return index === -1 ? '' : (flags[index + 1] ?? '')
  }
  if (rest.length % 2 !== 0) {
    console.error('error: files must be given in <current> <baseline> pairs')
    process.exit(2)
  }
  const pairs = rest
    .filter((_, index) => index % 2 === 0)
    .map((current, index) => {
      const baseline = rest[index * 2 + 1] ?? '-'
      return { current, baseline: baseline === '-' ? undefined : baseline }
    })
  return {
    scope: flagValue('--scope') || 'given paths',
    base: flagValue('--base') || 'HEAD',
    root: flagValue('--root') || process.cwd(),
    pairs,
  }
}

const main = (): void => {
  const { scope, base, root, pairs } = parseArguments(process.argv.slice(2))

  /*
   * The supported-variable list is a copy of one in the runtime, so it can go
   * stale. A name this script accepts that the runtime no longer substitutes
   * would make the checker approve a prompt that renders braces, so the drift
   * is an environment error rather than a finding.
   */
  const variableSourcePath = join(root, VARIABLE_SOURCE)
  if (existsSync(variableSourcePath)) {
    const source = readFileSync(variableSourcePath, 'utf8')
    const missing = SUPPORTED_VARIABLES.filter(
      (name) => !source.includes(`${name}:`),
    )
    if (missing.length > 0) {
      console.error(
        `error: ${VARIABLE_SOURCE} no longer defines ${missing.join(', ')}; ` +
          'update SUPPORTED_VARIABLES in prompt-contract.ts before trusting this check',
      )
      process.exit(2)
    }
  }

  const corpus = testCorpus(join(root, 'runtime'))
  const envelopePath = join(root, ENVELOPE_SOURCE)
  const envelopeSource = existsSync(envelopePath)
    ? readFileSync(envelopePath, 'utf8')
    : ''

  const findings = pairs.flatMap((pair): readonly Finding[] => {
    if (!existsSync(pair.current)) {
      console.error(`error: no such file: ${pair.current}`)
      process.exit(2)
    }
    const relativePath = relative(root, pair.current) || pair.current
    const text = readFileSync(pair.current, 'utf8')
    const structural = structuralFindings(pair.current, relativePath, text)
    if (pair.baseline === undefined) return structural
    const baseline = readFileSync(pair.baseline, 'utf8')
    return [
      ...structural,
      ...comparativeFindings(
        relativePath,
        text,
        baseline,
        corpus,
        envelopeSource,
      ),
    ]
  })

  for (const finding of findings) {
    console.log(`  ${finding.file}:${finding.line}`)
    console.log(`      [${finding.rule}] ${finding.message}`)
  }

  console.log('')
  console.log(
    `check-prompt: scope=${scope} base=${base} checked=${pairs.length} ` +
      `violations=${findings.length}`,
  )

  if (findings.length > 0) {
    console.log('')
    console.log(
      'Rules: .claude/skills/prompt-authoring/SKILL.md, ' +
        'references/harness-contract.md',
    )
    process.exit(1)
  }
  console.log('All checked prompts keep their contract.')
}

main()
