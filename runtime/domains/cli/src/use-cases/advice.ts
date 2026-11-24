/**
 * Turning an triage's chosen chain into the command that would run it.
 *
 * The agent does not write this line. It chose activities; the shape of the
 * invocation belongs to the code that knows what `compose` takes today, and
 * an agent guessing at flags produces a command that looks right and fails
 * on paste. Keeping it here also means one place changes when the CLI does.
 */

import type { TRunState } from '../../../../lib/contracts'
import { RUN_RECIPE } from './recipe-line'

/** The envelope field the chain lives in, as the trace recorded it. */
const chainOf = (state: TRunState): readonly string[] =>
  state.envelopes
    .filter((envelope) => envelope.agent === 'triage' && envelope.valid)
    .flatMap((envelope) => {
      const activities = (envelope.payload as { steps?: unknown }).steps
      return Array.isArray(activities)
        ? activities.filter(
            (activity): activity is string => typeof activity === 'string',
          )
        : []
    })

/**
 * A prompt safe to sit inside double quotes in a shell.
 *
 * A request is usually a path, but it can be a sentence containing an
 * apostrophe or a quote — and a command that breaks on paste is worse than
 * no command, because it reads as the factory being broken rather than the
 * quoting being hard.
 */
export const shellQuoted = (value: string): string =>
  `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('$', '\\$').replaceAll('`', '\\`')}"`

/**
 * The line to run, or nothing when the triage chose no usable chain.
 *
 * Nothing rather than an empty `--activities`: a command that would start a run
 * with no activities is not a smaller recommendation, it is a broken one.
 */
export const adviceCommand = (
  state: TRunState,
  prompt: string,
): string | undefined => {
  const chain = chainOf(state)
  if (chain.length === 0) return undefined
  return `crust ${RUN_RECIPE} ${shellQuoted(prompt)} --activities ${chain.join(',')}`
}
