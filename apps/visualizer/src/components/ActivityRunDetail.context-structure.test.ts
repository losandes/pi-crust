import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/*
 * ActivityRunDetail.layout.test.ts (1.2.1-1.2.7) measures the context tab's
 * rendered geometry in a real browser, proving 1.1.1 and 1.1.3. It cannot
 * see the stylesheet or markup itself, so it cannot tell a `.context` rule
 * with no grid left over from a `.context` rule that merely has a wide
 * enough intrinsic width to pass today and regress tomorrow. These tests
 * read the source directly to hold the remaining, source-level requirements
 * from the gh-41 plan: 1.1.2, 1.1.4, 1.1.5, 1.1.6, 1.3.1 and 1.3.2.
 */

const CSS_PATH = join(import.meta.dir, 'ActivityRunDetail.module.css')
const TSX_PATH = join(import.meta.dir, 'ActivityRunDetail.tsx')

const css = readFileSync(CSS_PATH, 'utf8')
const tsx = readFileSync(TSX_PATH, 'utf8')

/** The declaration block for a given top-level selector, e.g. `.context`. */
const ruleBlock = (source: string, selector: string): string | undefined => {
  const marker = `${selector} {`
  const start = source.indexOf(marker)
  if (start === -1) return undefined
  const end = source.indexOf('}', start)
  return source.slice(start, end + 1)
}

test(
  [
    'given ActivityRunDetail.module.css',
    'when the context tab rule is read',
    'it should declare a `.context` class, not the old `.grid` class',
  ].join(', '),
  () => {
    // given/when
    const contextRule = ruleBlock(css, '.context')
    const gridRule = ruleBlock(css, '.grid')

    // then — 1.1.6: the class is named for the tab, matching .chat/.events/.highlights
    expect(contextRule).toBeDefined()
    // then — target-state block: `.grid` no longer exists anywhere in this stylesheet
    expect(gridRule).toBeUndefined()
  },
)

test(
  [
    'given the `.context` rule in ActivityRunDetail.module.css',
    'when its declarations are read',
    'it should keep the same padding the other three tabs use, and declare nothing that constrains its width',
  ].join(', '),
  () => {
    // given
    const contextRule = ruleBlock(css, '.context')
    expect(contextRule).toBeDefined()
    if (contextRule === undefined) return // unreachable; narrows the type for tsc

    // then — 1.1.2: identical padding to .chat, .events and .highlights
    expect(contextRule).toMatch(/padding:\s*16px 18px 20px/)

    // then — 1.1.4: no grid split, max-width, or auto margin narrowing the content
    expect(contextRule).not.toMatch(/grid-template-columns/)
    expect(contextRule).not.toMatch(/max-width/)
    expect(contextRule).not.toMatch(/margin:\s*0 auto/)
  },
)

test(
  [
    'given ActivityRunDetail.module.css',
    'when the stylesheet is searched for a max-width-1100px breakpoint on the context tab',
    'it should find none, because a single-column layout has nothing left to collapse',
  ].join(', '),
  () => {
    // given/when
    const mediaBlocks = css.match(/@media \(max-width: 1100px\) \{[\s\S]*?\n\}/g) ?? []

    // then — 1.1.5: no remaining 1100px media query mentions the context tab or its
    // old grid selector; the one that remains (`.chatCols`/`.chatCol`) belongs to a
    // different tab and is explicitly out of scope.
    for (const block of mediaBlocks) {
      expect(block).not.toMatch(/\.grid\b/)
      expect(block).not.toMatch(/\.context\b/)
    }
  },
)

test(
  [
    'given ActivityRunDetail.module.css',
    'when the stylesheet is searched for a `.col` rule',
    'it should find none',
  ].join(', '),
  () => {
    // then — 1.3.2: no `.col` rule was added to give the dead wrapper a width
    expect(ruleBlock(css, '.col')).toBeUndefined()
  },
)

test(
  [
    'given ActivityRunDetail.tsx',
    'when the context tab panel is rendered',
    'it should reference `styles.context`, not `styles.grid`, and keep its `styles.col` child wrapper',
  ].join(', '),
  () => {
    // then — 1.1.6: ActivityRunDetail.tsx:428 was updated to the renamed class
    expect(tsx).toMatch(/active === 'context' \? styles\.context : styles\.hidden/)
    // then — target-state block: no reference to the old class remains
    expect(tsx).not.toMatch(/styles\.grid\b/)
    // then — 1.3.1: the dead `styles.col` wrapper inside the context panel stays
    // (also the events tab's own wrapper at ActivityRunDetail.tsx:785 — two in total)
    const colWrapperCount = (tsx.match(/<div className=\{styles\.col\}>/g) ?? []).length
    expect(colWrapperCount).toBe(2)
  },
)
