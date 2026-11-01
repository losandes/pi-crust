import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/*
 * SessionTrace.tsx has no React render-test infrastructure (see the gh-38
 * plan's 5.3 — no Testing Library, no `renderToStaticMarkup` harness, and
 * the one component test in this directory drives real Chromium only
 * because it measures geometry a source read cannot). The five cards in
 * the standalone (no-Activity-selected) fragment are plain JSX siblings
 * with no `order` CSS, no sorting, and no reparenting, so document order
 * is render order (plan 5.1) — exactly what `ActivityRunDetail
 * .context-structure.test.ts` already relies on for a structural property
 * in a neighbouring component. This file holds the same proof the gh-38
 * plan's own "Proves it — source order" step runs by hand, as an
 * automated regression guard.
 */

const TSX_PATH = join(import.meta.dir, 'SessionTrace.tsx')
const tsx = readFileSync(TSX_PATH, 'utf8')

/** The standalone fragment: `session !== undefined && selectedActivityRun === undefined && (...)`. */
const standaloneFragment = (source: string): string => {
  const marker = 'session !== undefined && selectedActivityRun === undefined && ('
  const start = source.indexOf(marker)
  if (start === -1) throw new Error('standalone fragment guard not found')
  // The fragment closes with `)}` before the next top-level comment block
  // ("One agent at a time, chosen by the Gantt."); that marker is unique
  // and always follows this fragment in the file today.
  const end = source.indexOf('One agent at a time, chosen by the Gantt.', start)
  if (end === -1) throw new Error('end of standalone fragment not found')
  return source.slice(start, end)
}

const CARD_NAMES = ['RunNotices', 'DecisionRequest', 'RunControls', 'SessionContext', 'TreeWarnings'] as const

/** Index of each card's opening tag within the fragment, in source order. */
const cardPositions = (fragment: string): Record<(typeof CARD_NAMES)[number], number> =>
  Object.fromEntries(CARD_NAMES.map((name) => [name, fragment.indexOf(`<${name}`)])) as Record<
    (typeof CARD_NAMES)[number],
    number
  >

test(
  [
    'given the standalone (no Activity selected) fragment in SessionTrace.tsx',
    'when the five sibling cards are located',
    'it should render TreeWarnings last, after RunNotices, DecisionRequest, RunControls and SessionContext',
  ].join(', '),
  () => {
    // given
    const fragment = standaloneFragment(tsx)
    const positions = cardPositions(fragment)

    // then — every card is present
    for (const name of CARD_NAMES) {
      expect(positions[name]).toBeGreaterThan(-1)
    }

    // then — 1.1.1: TreeWarnings carries the highest position of the five
    const highest = Math.max(...Object.values(positions))
    expect(positions.TreeWarnings).toBe(highest)
  },
)

test(
  [
    'given the standalone fragment in SessionTrace.tsx',
    'when the remaining four cards are located',
    'it should keep them in their existing relative order: RunNotices, DecisionRequest, RunControls, SessionContext',
  ].join(', '),
  () => {
    // given
    const fragment = standaloneFragment(tsx)
    const positions = cardPositions(fragment)

    // then — 1.1.2
    expect(positions.RunNotices).toBeLessThan(positions.DecisionRequest)
    expect(positions.DecisionRequest).toBeLessThan(positions.RunControls)
    expect(positions.RunControls).toBeLessThan(positions.SessionContext)
    expect(positions.SessionContext).toBeLessThan(positions.TreeWarnings)
  },
)

test(
  [
    'given the TreeWarnings element in the standalone fragment',
    'when its tag and immediately preceding comment are read',
    'it should be moved verbatim — unchanged props, and preceded by the explanatory comment about the warnings living at the run level',
  ].join(', '),
  () => {
    // given
    const fragment = standaloneFragment(tsx)

    // then — 1.1.3: same component, same props, same values
    expect(fragment).toMatch(/<TreeWarnings warnings=\{warningsIn\(events\)\} standalone \/>/)

    // then — 1.1.4: the explanatory comment is its immediately preceding sibling
    // and its wording is unchanged
    const commentThenElement =
      /Everything the run saw in the working tree and could not\s*\n\s*attribute\. On the run rather than on an Activity, because a\s*\n\s*reader with nothing selected is asking what happened to the\s*\n\s*repository, and a warning raised by the second of nine\s*\n\s*Activities is still the answer when the ninth has finished\.\s*\n\s*\*\/\}\s*\n\s*<TreeWarnings warnings=\{warningsIn\(events\)\} standalone \/>/
    expect(fragment).toMatch(commentThenElement)
  },
)

test(
  [
    'given SessionTrace.tsx',
    'when the standalone fragment\'s guard and the RunControls conditional are read',
    'it should keep both conditions unchanged by this reorder',
  ].join(', '),
  () => {
    // then — 1.2.1: the guard for the whole block is untouched
    expect(tsx).toMatch(
      /session !== undefined && selectedActivityRun === undefined && \(/,
    )

    // then — 1.2.2: RunControls still only renders while running or waiting
    expect(tsx).toMatch(
      /\(session\.status === 'running' \|\| session\.status === 'waiting'\) && \(\s*\n\s*<RunControls/,
    )
  },
)

test(
  [
    'given the per-Activity session view in ActivityRunDetail.tsx',
    'when it is checked for a TreeWarnings element',
    'it should still render its own TreeWarnings card, unaffected by the standalone-view reorder',
  ].join(', '),
  () => {
    // given — out of scope per the gh-38 plan (section 3): the selected-Activity
    // view renders a separate TreeWarnings and must not have been touched.
    const activityDetailPath = join(import.meta.dir, 'ActivityRunDetail.tsx')
    const activityDetailTsx = readFileSync(activityDetailPath, 'utf8')

    // then
    expect(activityDetailTsx).toMatch(/<TreeWarnings/)
  },
)
