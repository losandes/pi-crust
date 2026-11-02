/**
 * What makes a dispute a dispute rather than a refusal.
 *
 * The harness settles disagreements, not either agent, so "I checked and the
 * reviewer is wrong" has to be something a third party can re-check. Two
 * shapes qualify, and they are the whole vocabulary: a `path:line` a reader can
 * open, or a command and the status it exited with. Prose is not evidence.
 *
 * Pure and text-only — nothing here reads a file or runs a command. The gate
 * that uses it (`use-cases/gates/dispute-gates.ts`) is what rejects an envelope.
 */

/** `path/to/file.ts:42`, optionally with a column. */
export const EVIDENCE_PATH_LINE =
  /(?:^|\s)[^\s:]*[\w.-]\/?[\w.-]+:\d+(?::\d+)?\b/

/** a command's verdict: `exit 0`, `exited 1`, `exit status 2`, `exit_code: 0`. */
export const EVIDENCE_EXIT_STATUS =
  /\bexit(?:ed)?[\s_]*(?:code|status)?[:\s=]*\d+/i

export const hasEvidenceShape = (evidence: string): boolean =>
  EVIDENCE_PATH_LINE.test(evidence) || EVIDENCE_EXIT_STATUS.test(evidence)

/**
 * Compare-ready text: lowercase, whitespace collapsed, trailing punctuation off.
 *
 * Two agents restating the same finding rarely spell it identically, and the
 * repeat count the loop bound depends on is only as good as this comparison.
 */
export const normalise = (text: string): string =>
  text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.,;:!?]+$/, '')

/** Whole-word containment — `test` must not match `latest` or `contest`. */
export const namesWord = (text: string, word: string): boolean => {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, 'i').test(text)
}
