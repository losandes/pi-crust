import type { Page } from 'playwright'

/*
 * Under `reducedMotion: 'reduce'`, the theme layer's reduced-motion rule sets
 * a 0.01ms `transition-duration` on every element. `transition-property`
 * defaults to `all`, so every computed property a theme switch changes starts
 * a transition, and a `getComputedStyle` read before that transition finishes
 * still returns the previous theme's value. Waiting a fixed number of frames
 * does not settle it reliably; waiting for the transitions does. Only CSS
 * transitions are awaited: a keyframe animation may be infinite when motion is
 * enabled, and its `finished` never resolves. A transition cancelled by a
 * later style change rejects `finished`, hence `allSettled`.
 *
 * The page-side code is a string rather than a function: a function passed to
 * `evaluate` runs in the browser, so bun's coverage would count it as an
 * uncovered function in this file.
 */
const SETTLE = `Promise.allSettled(
  document
    .getAnimations()
    .filter((animation) => animation instanceof CSSTransition)
    .map((animation) => animation.finished),
).then(() => undefined)`

/**
 * Resolves once every CSS transition running in the page has finished or been
 * cancelled, so computed styles read afterwards are final.
 */
export const settleTransitions = async (
  page: Readonly<Pick<Page, 'evaluate'>>,
): Promise<void> => {
  await page.evaluate(SETTLE)
}
