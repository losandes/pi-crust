/**
 * Sending a run back to a step with new instructions.
 *
 * An agent can already do this: a stage that cannot work with what it was
 * given asks to regress, and the fold rewinds to that step and replays
 * everything from there in order. `steer` is the same act performed by a
 * person, which is why it reuses the same idea rather than inventing one —
 * the steps between the target and the end are a chain, and a change at the
 * start of a chain is a change to all of it.
 *
 * What it is NOT is a way to re-run one step in isolation. That exists and is
 * called `amend`: it revises a step's own document without touching anything
 * downstream, because you have judged the change superficial. `steer` is for
 * when you have not.
 */

import type { TPhaseState } from '../typedefs/run-state'

/**
 * How a branch inherits the conversations it is branching from.
 *
 * `fork` copies each agent's session, so the replayed step sees its own
 * earlier attempt and the instruction that rejected it. That is usually what
 * you want: the rejected attempt is WHY you are steering, and an agent that
 * cannot see it tends to re-derive it.
 *
 * `fresh` starts the agents over against the handoff documents alone. It
 * loses the reasoning and costs far less, and it is the right choice when the
 * old conversation is the problem rather than the context.
 */
export type TSeeding = 'fork' | 'fresh'

/**
 * Where the result goes, and the one thing a caller must say out loud.
 *
 * There is no default. `overwrite` discards the path you are steering away
 * from — the replayed steps rewrite their own documents — and `branch` keeps
 * both as two runs. A default on a choice where one option destroys evidence
 * is a choice made by habit.
 */
export type TSteerTarget = 'overwrite' | 'branch'

export type TSteer = Readonly<{
  target: TSteerTarget
  /** Only meaningful for a branch; an overwrite continues what exists. */
  seeding: TSeeding
  step: string
  note: string
}>

/**
 * The steps a steer will replay: the target and everything after it.
 *
 * By sequence rather than by the configured order, because the sequence is
 * what actually happened — a run whose steps were reordered, or which
 * regressed once already, is described by its trace and not by its config.
 */
export const stepsToReplay = (
  phases: readonly TPhaseState[],
  step: string,
): readonly string[] => {
  const target = phases.filter((phase) => phase.name === step).at(-1)
  if (target === undefined) return []
  const after = phases.filter((phase) => phase.seq >= target.seq)
  return [...new Set(after.map((phase) => phase.name))]
}

/**
 * The phase rows a steer must mark superseded for the replay to happen.
 *
 * Resume skips a step whose LATEST phase succeeded, so this is precisely the
 * set that would otherwise be skipped. Earlier attempts are left alone: they
 * are history, and the one being replaced is the one that was standing.
 */
export const phasesToSupersede = (
  phases: readonly TPhaseState[],
  step: string,
): readonly string[] => {
  const names = new Set(stepsToReplay(phases, step))
  return phases
    .filter((phase) => names.has(phase.name) && phase.status === 'success')
    .filter(
      (phase) =>
        !phases.some(
          (other) => other.name === phase.name && other.seq > phase.seq,
        ),
    )
    .map((phase) => phase.phase_id)
}

/**
 * The note, as every replayed agent will read it.
 *
 * Appended rather than replacing anything: a run steered twice has been
 * steered twice, and the second instruction rarely cancels the first.
 */
export const steeringEntry = (
  step: string,
  note: string,
  at: string,
): string =>
  [
    `## Steering — sent back to \`${step}\` at ${at}`,
    '',
    note.trim(),
    '',
  ].join('\n')

/**
 * What is spliced into a replayed agent's prompt.
 *
 * Deliberately not a template variable the prompts opt into: a steered run
 * where one agent's prompt forgot to include `{{steering}}` is a run that
 * silently ignored the person, and the whole point is that every step from
 * the branch point onward hears it.
 */
export const steeringBlock = (steering: string): string =>
  steering.trim() === ''
    ? ''
    : [
        '',
        '## Steering from the developer',
        '',
        'This run was sent back to an earlier step with new instructions.',
        'They apply to you, and they override what the earlier pass of this',
        'step concluded wherever the two conflict.',
        '',
        steering.trim(),
      ].join('\n')
