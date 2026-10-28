/**
 * What a run is called, on one terminal line and in the visualizer.
 *
 * `name` is a free-text label a person gave the run with `--name`; `lifecycle`
 * is what `sessions.lifecycle` already holds. Storage keeps the full string;
 * only the rendered line is clipped, so the stored value is never the lossy
 * one.
 */

import { clip } from '../data/terminal'

/** A stored --name over this many characters is refused, not truncated. */
export const RUN_NAME_MAX = 200

/** How much of the label fits beside a run id and a status on one line. */
export const RUN_LABEL_WIDTH = 48

/** The name when there is one, otherwise the lifecycle. Never clipped. */
export const runLabel = (name: string, lifecycle: string): string =>
  name === '' ? lifecycle : name

/** `runLabel`, clipped for one line of terminal. Display only. */
export const displayLabel = (name: string, lifecycle: string): string =>
  clip(runLabel(name, lifecycle), RUN_LABEL_WIDTH)

/**
 * Validate a `--name` value. Throws a usage error on a newline or on more
 * than `RUN_NAME_MAX` characters — a boundary on what may be stored at all,
 * not a second truncation.
 */
export const runName = (value: string | undefined): string | undefined => {
  if (value === undefined) {
    return undefined
  }
  if (value.includes('\n')) {
    throw new Error('--name may not contain a newline')
  }
  if (value.length > RUN_NAME_MAX) {
    throw new Error(
      `--name is ${value.length} characters; the limit is ${RUN_NAME_MAX}`,
    )
  }
  return value
}
