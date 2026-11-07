/**
 * Independent coverage of issue #62's requirements (1.1.1–1.1.10, 1.2.1,
 * 1.2.2). No other test file reads `identify/user.md` or `diagnose/user.md`
 * for this instruction, and `gh-issue/`'s own tests cover the harness's
 * rendering, not what the agent is told to do with `{{prompt}}`. These
 * assertions are the behavioural contract this fix depends on the agent
 * honouring: that `identify` and `diagnose` carry the operator's whole
 * request forward into a `## Request` section before anything else, with a
 * byte-identical instruction in both files, and that `gh-issue` does the
 * same on its own-words path while leaving its chain-copying path alone.
 */

import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PROMPT_DIR = join(__dirname)

const readPrompt = (activity: string): string =>
  readFileSync(join(PROMPT_DIR, activity, 'user.md'), 'utf8')

const HEADING = '## Carry the request forward'

const extractSection = (text: string): string => {
  const start = text.indexOf(HEADING)
  if (start === -1) {
    return ''
  }
  const rest = text.slice(start)
  const lines = rest.split('\n')
  const endIndex = lines.findIndex(
    (line, index) => index > 0 && line.startsWith('## '),
  )
  const sectionLines = endIndex === -1 ? lines : lines.slice(0, endIndex)
  return sectionLines.join('\n')
}

const identifySection = (): string => extractSection(readPrompt('identify'))
const diagnoseSection = (): string => extractSection(readPrompt('diagnose'))

test(
  [
    'given identify/user.md and diagnose/user.md',
    'when the "## Carry the request forward" section is extracted from each',
    'it should be present and byte-identical in both files (1.1.1, 1.1.2)',
  ].join(', '),
  () => {
    // given
    const identify = identifySection()

    // when
    const diagnose = diagnoseSection()

    // then
    expect(identify.length).toBeGreaterThan(0)
    expect(diagnose.length).toBeGreaterThan(0)
    expect(identify).toBe(diagnose)
  },
)

test(
  [
    'given the extracted "Carry the request forward" section',
    'when read',
    'it should say the output document opens with a "## Request" section written before anything else, on every run including one that cannot otherwise complete (1.1.3, 1.1.9)',
  ].join(', '),
  () => {
    // given
    const section = identifySection()

    // when
    const matches = {
      request: /##\s*request/i.test(section),
      firstThing: /written before anything else/i.test(section),
      everyRun: /every run, including one you cannot otherwise complete/i.test(
        section,
      ),
    }

    // then
    expect(matches.request).toBe(true)
    expect(matches.firstThing).toBe(true)
    expect(matches.everyRun).toBe(true)
  },
)

test(
  [
    'given the extracted "Carry the request forward" section',
    'when read',
    'it should require the prompt variable reproduced verbatim in a fenced block and must not contain the literal {{prompt}} (1.1.4, 1.1.10)',
  ].join(', '),
  () => {
    // given
    const section = identifySection()

    // when
    const matches = {
      verbatim: /reproduce `prompt` verbatim/i.test(section),
      fenced: /fenced block/i.test(section),
      noPromptToken: !section.includes('{{prompt}}'),
    }

    // then
    expect(matches.verbatim).toBe(true)
    expect(matches.fenced).toBe(true)
    expect(matches.noPromptToken).toBe(true)
  },
)

test(
  [
    'given the extracted "Carry the request forward" section',
    'when read',
    'it should require a pointed-at file read and reproduced whole under a "### <path>" heading, and say a path is not a request (1.1.5)',
  ].join(', '),
  () => {
    // given
    const section = identifySection()

    // when
    const matches = {
      pointsAtFile: /points at a file in this repository/i.test(section),
      wholeContents: /whole contents/i.test(section),
      pathHeading: section.includes('### <path>'),
      pathNotRequest: /a path is not a request/i.test(section),
    }

    // then
    expect(matches.pointsAtFile).toBe(true)
    expect(matches.wholeContents).toBe(true)
    expect(matches.pathHeading).toBe(true)
    expect(matches.pathNotRequest).toBe(true)
  },
)

test(
  [
    'given the extracted "Carry the request forward" section',
    'when read',
    'it should require shell concatenation rather than retyping, and a fence longer than the longest backtick run in the quoted text (1.1.6, 1.1.7)',
  ].join(', '),
  () => {
    // given
    const section = identifySection()

    // when
    const matches = {
      shellConcat: /shell concatenation/i.test(section),
      printf: /`printf`/i.test(section),
      cat: /`cat`/i.test(section),
      ratherThanRetyping: /rather than retyping/i.test(section),
      fenceLonger: /more backticks than the longest run/i.test(section),
    }

    // then
    expect(matches.shellConcat).toBe(true)
    expect(matches.printf).toBe(true)
    expect(matches.cat).toBe(true)
    expect(matches.ratherThanRetyping).toBe(true)
    expect(matches.fenceLonger).toBe(true)
  },
)

test(
  [
    'given the extracted "Carry the request forward" section',
    'when read',
    'it should require an unreadable file recorded with its path and reason, and forbid reconstruction (1.1.8)',
  ].join(', '),
  () => {
    // given
    const section = identifySection()

    // when
    const matches = {
      recordsReason: /cannot be read, write its path and the reason/i.test(
        section,
      ),
      recordsAssumption: /record it in `assumptions`/i.test(section),
      forbidsReconstructing: /never reconstruct a file you did not read/i.test(
        section,
      ),
    }

    // then
    expect(matches.recordsReason).toBe(true)
    expect(matches.recordsAssumption).toBe(true)
    expect(matches.forbidsReconstructing).toBe(true)
  },
)

test(
  [
    'given gh-issue/user.md',
    'when read',
    'it should require the own-words path to lead with a "## Request" section carrying the prompt verbatim and a pointed-at file\'s whole contents (1.2.1)',
  ].join(', '),
  () => {
    // given
    const text = readPrompt('gh-issue')
    const bulletStart = text.indexOf('Only when nothing ran before you')
    const bulletEnd = text.indexOf('5. Create the issue')

    // when
    const bullet = text.slice(bulletStart, bulletEnd)
    const matches = {
      request: /##\s*request/i.test(bullet),
      promptVerbatim: /`prompt` variable verbatim/i.test(bullet),
      fenced: /fenced block/i.test(bullet),
      wholeContents: /whole contents/i.test(bullet),
      pathHeading: bullet.includes('### <path>'),
      catAppended: /appended with `cat`/i.test(bullet),
    }

    // then
    expect(bulletStart).toBeGreaterThan(-1)
    expect(bulletEnd).toBeGreaterThan(bulletStart)
    expect(matches.request).toBe(true)
    expect(matches.promptVerbatim).toBe(true)
    expect(matches.fenced).toBe(true)
    expect(matches.wholeContents).toBe(true)
    expect(matches.pathHeading).toBe(true)
    expect(matches.catAppended).toBe(true)
  },
)

test(
  [
    'given gh-issue/user.md',
    'when read',
    'it should still require every upstream handoff document copied verbatim, in order, under its own heading, and still forbid summarising or rewording (1.2.2)',
  ].join(', '),
  () => {
    // given
    const text = readPrompt('gh-issue')
    const bulletStart = text.indexOf(
      'When the chain produced handoff documents',
    )
    const bulletEnd = text.indexOf('Only when nothing ran before you')

    // when
    const bullet = text.slice(bulletStart, bulletEnd)
    const matches = {
      copyEachOne: /copy each one into/i.test(bullet),
      verbatimInOrder: /verbatim, in the order the chain produced them/i.test(
        bullet,
      ),
      noSummarising:
        /do not summarise, reword, shorten, reorder or re-level/i.test(bullet),
    }

    // then
    expect(bulletStart).toBeGreaterThan(-1)
    expect(bulletEnd).toBeGreaterThan(bulletStart)
    expect(matches.copyEachOne).toBe(true)
    expect(matches.verbatimInOrder).toBe(true)
    expect(matches.noSummarising).toBe(true)
  },
)
