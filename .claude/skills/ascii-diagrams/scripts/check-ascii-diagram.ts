#!/usr/bin/env bun
/**
 * Blocking checker for exported ASCII diagrams.
 *
 * Usage:
 *   bun <skill>/scripts/check-ascii-diagram.ts <path>...
 *   cat diagram.txt | bun <skill>/scripts/check-ascii-diagram.ts -
 *   bun <skill>/scripts/check-ascii-diagram.ts --all
 *
 * A path may be a `.md` file, in which case every fenced code block that
 * looks like a diagram is checked, or a plain text file holding one diagram.
 *
 * Exit codes: 0 = clean, 1 = violations found, 2 = usage/environment error
 *
 * Unlike the other checkers here, this one does NOT default to files changed
 * against git. Diagrams are usually written straight into a conversation and
 * never reach a file, and the ones that do are checked when they are
 * exported, deliberately, rather than on every commit.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// The workspace root is derived from this script's own location, NOT from
// `git rev-parse --show-toplevel` — this workspace is nested inside a much
// larger repository, and the git toplevel would pull in unrelated code.
import { spawnSync } from 'node:child_process'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
/*
 * The project being worked in, not a path derived from this file's location.
 * This skill lives outside every repository it serves, so walking up from the
 * script would reach the home directory and `--all` would sweep it.
 */
const REPO_ROOT = (() => {
  const override = process.env.MY_WORKSPACE
  if (override !== undefined && override !== '') return resolve(override)
  const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' })
  const root = top.status === 0 ? top.stdout.trim() : ''
  return root === '' ? process.cwd() : root
})()

const TARGET_WIDTH = 80
const MAX_WIDTH = 100

/** Directories never walked in `--all` mode: build output and tooling. */
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
  'temp-data',
])

/** Box-drawing and marker glyphs the house style uses. */
const RAIL = '│┌└├┬┴┼─┐┘'
const ARROWS = '▶◀▲▼►◄▸→'

type Finding = {
  readonly file: string
  readonly line: number
  readonly rule: string
  readonly message: string
}

type Block = {
  readonly file: string
  /** 1-based line of the first line of the diagram within `file`. */
  readonly offset: number
  readonly lines: readonly string[]
}

/** A line's display width, counting a surrogate pair (emoji) as one column. */
const displayWidth = (line: string): number => [...line].length

/**
 * Which form this block is, from the glyphs present.
 *
 * Detection rather than a flag: a diagram pasted from elsewhere carries no
 * flag, and asking the caller to classify invites the wrong answer being
 * asserted confidently.
 */
type DiagramForm =
  | 'swimlane'
  | 'walkthrough'
  | 'workflow'
  | 'tree'
  | 'relationship'
  | 'data-model'
  | 'other'

const detectForm = (lines: readonly string[]): DiagramForm => {
  const body = lines.join('\n')

  if (lines.some((line) => /\s-{3,}/.test(line)) && /[┌└]─+▶/.test(body)) {
    return 'swimlane'
  }

  // Boxes decide this, not indentation. A workflow's box opens and closes on
  // one line; a walkthrough's rail opens, runs down the diagram, and closes
  // much later, so it never produces one. Testing the rail first and assuming
  // a workflow is indented classified every flush-left workflow as a
  // walkthrough, and its box and arrow rules then never ran — the diagram came
  // back clean because nothing had looked at it. Leading whitespace is a habit
  // nothing enforces, so it cannot carry the distinction.
  const hasClosedBox = /[┌└][─]+[┐┘]/.test(body)

  // Entities drawn as boxes are not a process drawn as boxes. Both forms mark
  // their edges: a relationship diagram spells cardinality as `1..n`, and a
  // data model carries `PK`/`FK` in its first column. Neither owes the workflow
  // geometry — an entity's height is the number of columns it holds, and
  // rounding that to an odd number would be advice about nothing.
  if (hasClosedBox && /[01]\.\.[0-9n]/.test(body)) {
    return 'relationship'
  }

  if (hasClosedBox && /(^|[│ ])(PK|FK) /m.test(body)) {
    return 'data-model'
  }

  if (hasClosedBox && /[▼▶]/.test(body)) {
    return 'workflow'
  }

  if (!hasClosedBox && /^┌─/m.test(body) && /^└─/m.test(body)) {
    return 'walkthrough'
  }

  if (/^[│ ]*[├└]── /m.test(body)) {
    return 'tree'
  }

  return 'other'
}

/**
 * Rules that apply to every form.
 *
 * The width advice is form-specific. A swimlane cannot simply be made
 * narrower — its width is driven by the number of steps, an unbounded
 * dimension — so telling its author "too wide" names a violation they
 * cannot act on. A checker that names the fix gets followed; one that
 * names only the breach gets worked around.
 */
const checkUniversal = (
  block: Block,
  form: DiagramForm,
): readonly Finding[] =>
  block.lines.flatMap((line, index) => {
    const at = (rule: string, message: string): Finding => ({
      file: block.file,
      line: block.offset + index,
      rule,
      message,
    })

    const width = displayWidth(line)

    return [
      ...(line !== line.replace(/[ \t]+$/, '')
        ? [
            at(
              'trailing-whitespace',
              'trailing whitespace: invisible here, red in a GitHub diff, and stripped on save by editors that then re-ragged the right edge',
            ),
          ]
        : []),
      ...(line.includes('\t')
        ? [
            at(
              'tab-character',
              'tab character: column alignment depends on tab width, so the diagram renders differently for every reader',
            ),
          ]
        : []),
      ...(width > MAX_WIDTH
        ? [
            at(
              'over-max-width',
              form === 'swimlane'
                ? `${width} columns exceeds the ${MAX_WIDTH} hard cap. Do not shrink the boxes or the lane-title field — raise the altitude (fewer, named phases, with a walkthrough expanding one) or wrap into bands: see references/swimlane.md`
                : `${width} columns exceeds the ${MAX_WIDTH} hard cap; GitHub will scroll it horizontally and a PR split diff shows about half`,
            ),
          ]
        : []),
      ...(width > TARGET_WIDTH && width <= MAX_WIDTH
        ? [
            at(
              'over-target-width',
              form === 'swimlane'
                ? `${width} columns is past the ${TARGET_WIDTH} target; legal, but a swimlane only grows from here — consider bands before it does`
                : `${width} columns is past the ${TARGET_WIDTH} target; legal, but it scrolls in a PR split diff`,
            ),
          ]
        : []),
    ]
  })

/**
 * Tree and decision-tree rules.
 *
 * Checks the two things that break when a tree is hand-edited later: a
 * branch continuing after the last child has been declared, and an ancestor
 * rail that stops one level early so the descendants float.
 */
const checkTree = (block: Block): readonly Finding[] => {
  const connectorColumn = (line: string): number => {
    const index = [...line].findIndex(
      (char, position) =>
        (char === '├' || char === '└') &&
        [...line].slice(position, position + 3).join('') ===
          `${char}──`,
    )

    return index
  }

  // Columns where a `└──` has already been seen; a later `├──` or `└──` in
  // the same column is a sibling of a branch that was declared closed.
  //
  // State is reset for every deeper column each time a connector appears,
  // because a connector at column c means every subtree below c has ended.
  // Without that reset, the second subtree at a given depth looks like a
  // reopened branch and every well-formed tree reports violations — which
  // is worse than no check, since the noise trains the reader to ignore it.
  const closed = new Set<number>()

  return block.lines.flatMap((line, index) => {
    const column = connectorColumn(line)

    if (column < 0) {
      // A continuation line must carry a rail at every open ancestor column.
      return []
    }

    const at = (rule: string, message: string): Finding => ({
      file: block.file,
      line: block.offset + index,
      rule,
      message,
    })

    const isLast = [...line][column] === '└'
    const findings: Finding[] = []

    for (const seen of [...closed]) {
      if (seen > column) {
        closed.delete(seen)
      }
    }

    if (closed.has(column)) {
      findings.push(
        at(
          'sibling-after-last',
          `a branch at column ${column + 1} continues after \`└──\` declared the last child; use \`├──\` for every child but the final one`,
        ),
      )
    }

    // Every ancestor column must hold a rail or a space, never text.
    const chars = [...line]
    for (let ancestor = 0; ancestor < column; ancestor += 4) {
      const char = chars[ancestor] ?? ' '

      if (char !== '│' && char !== ' ') {
        findings.push(
          at(
            'rail-misaligned',
            `column ${ancestor + 1} holds ${JSON.stringify(char)} where an ancestor rail \`│\` or a space belongs; the indent is not a multiple of 4, or a rail was dropped`,
          ),
        )
        break
      }
    }

    if (isLast) {
      closed.add(column)
    } else {
      closed.delete(column)
    }

    return findings
  })
}

/**
 * Swimlane rules.
 *
 * The axis rail, the lane-title field and the lane dividers are the three
 * things that drift when a lane is added later, and all three are what make
 * the form readable at a glance.
 */
const checkSwimlane = (block: Block): readonly Finding[] => {
  const axisColumns = block.lines.flatMap((line) => {
    const index = [...line].findIndex((char) => RAIL.includes(char))

    return index < 0 ? [] : [index]
  })

  // The axis is the column the rail occupies most often, so one drifted
  // line is reported against the block rather than redefining the block.
  const axis = axisColumns.toSorted(
    (a, b) =>
      axisColumns.filter((column) => column === b).length -
      axisColumns.filter((column) => column === a).length,
  )[0]

  if (axis === undefined) {
    return []
  }

  const dividerEnds = block.lines.flatMap((line) =>
    /\s-{3,}/.test(line) ? [line.replace(/\s+$/, '').length] : [],
  )
  const widestDivider = Math.max(...dividerEnds, 0)

  return block.lines.flatMap((line, index) => {
    const at = (rule: string, message: string): Finding => ({
      file: block.file,
      line: block.offset + index,
      rule,
      message,
    })

    const chars = [...line]
    const findings: Finding[] = []

    if (chars.length > axis && !RAIL.includes(chars[axis] ?? ' ')) {
      findings.push(
        at(
          'axis-drift',
          `the lane axis is at column ${axis + 1} elsewhere in this block but not on this line; lanes stop reading as lanes the moment the axis wanders`,
        ),
      )
    }

    const title = line.slice(0, axis)

    if (title.trim() !== '') {
      const gap = title.length - title.replace(/\s+$/, '').length

      if (gap !== 2) {
        findings.push(
          at(
            'lane-title-gap',
            `lane title is ${gap} space(s) from the axis; the house style right-justifies titles with exactly 2`,
          ),
        )
      }
    }

    if (/\s-{3,}/.test(line)) {
      const end = line.replace(/\s+$/, '').length

      if (end !== widestDivider) {
        findings.push(
          at(
            'divider-ragged',
            `lane divider ends at column ${end}, others end at ${widestDivider}; dividers share a right edge even when arrows punch through them`,
          ),
        )
      }
    }

    return findings
  })
}

/**
 * Workflow rules: boxes on a grid, with odd interior heights.
 *
 * An odd height is what allows a horizontal arrow to leave from the exact
 * vertical centre. Padding a box to an even height to fit a label is the
 * common edit, and it silently decentres every arrow that meets it — which
 * is why the height is checked rather than the arrow.
 */
const checkWorkflow = (block: Block): readonly Finding[] => {
  type OpenBox = { readonly column: number; readonly line: number }
  type Box = {
    readonly left: number
    readonly right: number
    readonly top: number
    readonly bottom: number
  }

  const findings: Finding[] = []
  const open = new Map<number, OpenBox>()
  const boxes: Box[] = []

  block.lines.forEach((line, index) => {
    const chars = [...line]

    chars.forEach((char, column) => {
      if (char === '┌') {
        // A box already open in this column was never closed. Reported
        // here rather than left in the map, where the new box would
        // overwrite it and the violation would vanish.
        const previous = open.get(column)

        if (previous !== undefined) {
          findings.push({
            file: block.file,
            line: block.offset + previous.line,
            rule: 'box-unclosed',
            message: `box opened at column ${previous.column + 1} is never closed with \`└\` in the same column`,
          })
        }

        open.set(column, { column, line: index })
      }

      if (char === '└') {
        const box = open.get(column)

        if (box === undefined) {
          return
        }

        open.delete(column)

        const topLine = [...(block.lines[box.line] ?? '')]
        const right = topLine.findIndex(
          (candidate, position) => candidate === '┐' && position > column,
        )

        boxes.push({
          left: column,
          right: right < 0 ? column : right,
          top: box.line,
          bottom: index,
        })

        const interior = index - box.line - 1

        if (interior > 0 && interior % 2 === 0) {
          findings.push({
            file: block.file,
            line: block.offset + box.line,
            rule: 'even-box-height',
            message: `box has ${interior} interior rows; heights are odd (1, 3, 5) so a horizontal arrow can leave from the exact centre row`,
          })
        }
      }
    })
  })

  // A horizontal arrow must sit on the centre row of BOTH boxes it joins,
  // which means connected boxes are vertically centred on each other. Not
  // top-aligned: a 1-row box joined to a 3-row box centres against it, so
  // aligning the borders would put the arrow off-centre at one end.
  block.lines.forEach((line, index) => {
    const chars = [...line]

    chars.forEach((char, column) => {
      if (char !== '▶') {
        return
      }

      // Walk back over the arrow's shaft to find where it left its source.
      const start = (() => {
        const scan = (position: number): number =>
          position > 0 && chars[position - 1] === '─' ? scan(position - 1) : position

        return scan(column)
      })()

      // Must also span this row: a diagram repeats boxes in the same
      // column, so matching on the edge alone finds the first one drawn
      // rather than the one this arrow leaves.
      const source = boxes.find(
        (box) =>
          box.right === start - 1 && box.top <= index && index <= box.bottom,
      )
      const target = boxes.find(
        (box) =>
          box.left === column + 1 && box.top <= index && index <= box.bottom,
      )

      const offCentre = [
        ...(source !== undefined && (source.top + source.bottom) / 2 !== index
          ? ['source']
          : []),
        ...(target !== undefined && (target.top + target.bottom) / 2 !== index
          ? ['target']
          : []),
      ]

      if (offCentre.length > 0) {
        findings.push({
          file: block.file,
          line: block.offset + index,
          rule: 'arrow-off-centre',
          message: `horizontal arrow is off the centre row of its ${offCentre.join(' and ')} box; boxes joined by an arrow are vertically CENTRED on each other so one row is the centre of both — not top-aligned, since a 1-row box centres against a 3-row box`,
        })
      }
    })
  })

  for (const box of open.values()) {
    findings.push({
      file: block.file,
      line: block.offset + box.line,
      rule: 'box-unclosed',
      message: `box opened at column ${box.column + 1} is never closed with \`└\` in the same column`,
    })
  }

  return findings
}

/**
 * Walkthrough rules: the rail is a closed channel.
 *
 * Every line between `┌─` and `└─` carries the rail, so the reader can see
 * at a glance where the process starts and ends. A gap reads as the end.
 */
const checkWalkthrough = (block: Block): readonly Finding[] => {
  const open = block.lines.findIndex((line) => line.startsWith('┌─'))
  const close = block.lines.findIndex((line) => line.startsWith('└─'))

  if (open < 0) {
    return []
  }

  if (close < 0) {
    return [
      {
        file: block.file,
        line: block.offset + open,
        rule: 'rail-unclosed',
        message:
          'the rail opens with `┌─` but never closes with `└─`; the closing line is where the fall-through case is stated',
      },
    ]
  }

  return block.lines.flatMap((line, index) => {
    if (index <= open || index >= close) {
      return []
    }

    const first = [...line][0] ?? ' '

    return RAIL.includes(first)
      ? []
      : [
          {
            file: block.file,
            line: block.offset + index,
            rule: 'rail-broken',
            message: `line starts with ${JSON.stringify(first)}; every line inside the rail begins with \`│\` so the channel reads as continuous`,
          },
        ]
  })
}

const checkBlock = (block: Block): readonly Finding[] => {
  const form = detectForm(block.lines)

  return [
    ...checkUniversal(block, form),
    ...(form === 'tree' ? checkTree(block) : []),
    ...(form === 'swimlane' ? checkSwimlane(block) : []),
    ...(form === 'walkthrough' ? checkWalkthrough(block) : []),
    ...(form === 'workflow' ? checkWorkflow(block) : []),
  ]
}

/** Pulls fenced blocks that look like diagrams out of a markdown file. */
const blocksFromMarkdown = (file: string, text: string): readonly Block[] => {
  const lines = text.split('\n')
  const fences = lines.flatMap((line, index) =>
    line.trimStart().startsWith('```') ? [index] : [],
  )

  // Pair the fences: open, close, open, close. An unclosed final fence is
  // dropped rather than treated as running to the end of the file.
  return fences.flatMap((open, position) => {
    if (position % 2 !== 0) {
      return []
    }

    const close = fences[position + 1]

    if (close === undefined) {
      return []
    }

    const body = lines.slice(open + 1, close)
    const isDiagram = body.some((candidate) =>
      [...candidate].some(
        (char) => RAIL.includes(char) || ARROWS.includes(char),
      ),
    )

    return isDiagram ? [{ file, offset: open + 2, lines: body }] : []
  })
}

const blocksFromFile = (file: string): readonly Block[] => {
  const text = readFileSync(file, 'utf8')

  return file.endsWith('.md')
    ? blocksFromMarkdown(file, text)
    : [{ file, offset: 1, lines: text.replace(/\n$/, '').split('\n') }]
}

const walk = (directory: string): readonly string[] =>
  readdirSync(directory).flatMap((entry) => {
    if (SKIPPED_DIRECTORIES.has(entry)) {
      return []
    }

    const full = join(directory, entry)

    return statSync(full).isDirectory()
      ? walk(full)
      : entry.endsWith('.md')
        ? [full]
        : []
  })

const readStdin = async (): Promise<string> => {
  const chunks: Uint8Array[] = []

  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(chunk)
  }

  return new TextDecoder().decode(Buffer.concat(chunks))
}

const main = async () => {
  const args = process.argv.slice(2)

  if (args.length === 0) {
    console.error(
      'usage: check-ascii-diagram.ts <path>... | --all | -   (see the header for details)',
    )
    process.exit(2)
  }

  // Read once: the stream cannot be consumed twice, and a second `await`
  // returns empty rather than failing, which would silently check nothing.
  const piped = args.includes('-') ? await readStdin() : undefined
  const fenced =
    piped === undefined ? [] : blocksFromMarkdown('<stdin>', piped)

  const blocks = args.includes('-')
    ? fenced.length > 0
      ? fenced
      : [
          {
            file: '<stdin>',
            offset: 1,
            lines: (piped ?? '').replace(/\n$/, '').split('\n'),
          },
        ]
    : args.includes('--all')
      ? walk(REPO_ROOT).flatMap(blocksFromFile)
      : args.flatMap((path) => {
          const full = resolve(path)

          // A path that does not exist is a usage error, not a crash: a
          // stack trace here reads as a broken checker rather than a typo.
          if (!existsSync(full)) {
            console.error(`error: no such file or directory: ${path}`)
            process.exit(2)
          }

          return statSync(full).isDirectory()
            ? walk(full).flatMap(blocksFromFile)
            : blocksFromFile(full)
        })

  const findings = blocks.flatMap(checkBlock)

  for (const finding of findings) {
    // Paths outside the workspace print absolute: a relative path climbing
    // out through `../../..` is unusable to paste back into a terminal.
    const inside = relative(REPO_ROOT, finding.file)
    const where =
      finding.file === '<stdin>'
        ? '<stdin>'
        : inside.startsWith('..')
          ? finding.file
          : inside || finding.file

    console.log(`${where}:${finding.line}`)
    console.log(`    [${finding.rule}] ${finding.message}`)
  }

  const blocking = findings.filter(
    (finding) => finding.rule !== 'over-target-width',
  )

  console.log(
    `check-ascii-diagram: blocks=${blocks.length} findings=${findings.length} blocking=${blocking.length}`,
  )

  if (blocking.length > 0) {
    console.log(
      '\nHouse style: this skill\u2019s SKILL.md, and the exemplar for the form in references/',
    )
  }

  process.exit(blocking.length > 0 ? 1 : 0)
}

await main()
