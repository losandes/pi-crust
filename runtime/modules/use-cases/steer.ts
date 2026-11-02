/**
 * Sending a run back to a activity with new instructions.
 *
 * An agent can already do this: a stage that cannot work with what it was
 * given asks to regress, and the fold rewinds to that activity and replays
 * everything from there in order. `steer` is the same act performed by a
 * person, which is why it reuses the same idea rather than inventing one —
 * the activities between the target and the end are a chain, and a change at the
 * start of a chain is a change to all of it.
 *
 * What it is NOT is a way to re-run one activity in isolation. That exists and is
 * called `amend`: it revises a activity's own document without touching anything
 * downstream, because you have judged the change superficial. `steer` is for
 * when you have not.
 */

import type { TActivityRunState } from '../typedefs/run-state'
import { latestByName } from './read-run-state'

/**
 * How a branch inherits the conversations it is branching from.
 *
 * `fork` copies each agent's session, so the replayed activity sees its own
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
 * from — the replayed activities rewrite their own documents — and `branch` keeps
 * both as two runs. A default on a choice where one option destroys evidence
 * is a choice made by habit.
 */
export type TSteerTarget = 'overwrite' | 'branch'

export type TSteer = Readonly<{
  target: TSteerTarget
  /** Only meaningful for a branch; an overwrite continues what exists. */
  seeding: TSeeding
  activity: string
  note: string
}>

/**
 * The activities a steer will replay: the target and everything after it.
 *
 * By sequence rather than by the configured order, because the sequence is
 * what actually happened — a run whose activities were reordered, or which
 * regressed once already, is described by its trace and not by its config.
 */
export const activitiesToReplay = (
  activityRuns: readonly TActivityRunState[],
  activity: string,
): readonly string[] => {
  const target = activityRuns
    .filter((activityRun) => activityRun.name === activity)
    .at(-1)
  if (target === undefined) return []
  const after = activityRuns.filter(
    (activityRun) => activityRun.seq >= target.seq,
  )
  return [...new Set(after.map((activityRun) => activityRun.name))]
}

/**
 * The activityRun rows a steer must mark superseded for the replay to happen.
 *
 * Resume skips a activity whose LATEST activityRun succeeded, so this is precisely the
 * set that would otherwise be skipped. Earlier attempts are left alone: they
 * are history, and the one being replaced is the one that was standing.
 */
export const activityRunsToSupersede = (
  activityRuns: readonly TActivityRunState[],
  activity: string,
): readonly string[] => {
  const names = new Set(activitiesToReplay(activityRuns, activity))
  return activityRuns
    .filter(
      (activityRun) =>
        names.has(activityRun.name) && activityRun.status === 'success',
    )
    .filter(
      (activityRun) =>
        !activityRuns.some(
          (other) =>
            other.name === activityRun.name && other.seq > activityRun.seq,
        ),
    )
    .map((activityRun) => activityRun.activity_run_id)
}

/**
 * The note, as every replayed agent will read it.
 *
 * Appended rather than replacing anything: a run steered twice has been
 * steered twice, and the second instruction rarely cancels the first.
 */
export const steeringEntry = (
  activity: string,
  note: string,
  at: string,
): string =>
  [
    `## Steering — sent back to \`${activity}\` at ${at}`,
    '',
    note.trim(),
    '',
  ].join('\n')

/**
 * What is spliced into a replayed agent's prompt.
 *
 * Deliberately not a template variable the prompts opt into: a steered run
 * where one agent's prompt forgot to include `{{steering}}` is a run that
 * silently ignored the person, and the whole point is that every activity from
 * the branch point onward hears it.
 */
export const steeringBlock = (steering: string): string =>
  steering.trim() === ''
    ? ''
    : [
        '',
        '## Steering from the developer',
        '',
        'A person sent this run back to an earlier activity, or picked it back up',
        'with a standing instruction. Either way, it applies to you, and it',
        'overrides what an earlier pass of this activity concluded wherever the',
        'two conflict.',
        '',
        steering.trim(),
      ].join('\n')

/**
 * The flag's value, or undefined when the flag is absent or bare.
 *
 * Shared by every reader of a `--flag value` pair so argv parsing says the
 * same thing everywhere it happens, rather than once per script.
 */
export const flagValue = (
  argv: readonly string[],
  flag: string,
): string | undefined => {
  const at = argv.indexOf(flag)
  if (at === -1) return undefined
  const value = argv[at + 1]
  return value === undefined || value.startsWith('--') ? undefined : value
}

/**
 * Where a steer's result goes — the one thing a caller must say out loud.
 *
 * Both or neither is not "either": it is somebody who has not decided, and a
 * default on a choice where one option destroys evidence would be a choice
 * made by habit rather than by a person.
 */
export const steerTargetOf = (
  argv: readonly string[],
): TSteerTarget | undefined => {
  const overwrite = argv.includes('--overwrite')
  const branch = argv.includes('--branch')
  return overwrite === branch ? undefined : overwrite ? 'overwrite' : 'branch'
}

/** How a branch inherits its conversations. `fork` unless `--seeding fresh`. */
export const seedingOf = (argv: readonly string[]): TSeeding =>
  flagValue(argv, '--seeding') === 'fresh' ? 'fresh' : 'fork'

/**
 * The standing successful activity runs a branch inherits: every one NOT in
 * `activitiesToReplay`. Built from the same `latestByName` the resume skip
 * reads, so the two sets can never disagree about what "standing" means.
 */
export const activityRunsToCarry = (
  activityRuns: readonly TActivityRunState[],
  activity: string,
): readonly TActivityRunState[] => {
  const replaying = new Set(activitiesToReplay(activityRuns, activity))
  return latestByName(activityRuns).filter(
    (activityRun) =>
      !replaying.has(activityRun.name) && activityRun.status === 'success',
  )
}

/**
 * A note from a person picking a run back up — not a send-back, so it gets
 * its own heading rather than steeringEntry's "sent back to" sentence.
 */
export const developerNote = (note: string, at: string): string =>
  [`## Instruction from the developer at ${at}`, '', note.trim(), ''].join('\n')

/**
 * What `execute-agent.ts` traces at the moment a non-empty steering block is
 * spliced into a prompt. `undefined` for an empty block, so the caller
 * traces nothing rather than an empty event every ordinary activity would
 * otherwise file.
 */
export const steeringAppliedEvent = (
  agent: string,
  steering: string,
):
  | Readonly<{
      name: 'steering_applied'
      payload: { agent: string; text: string }
    }>
  | undefined =>
  steering.trim() === ''
    ? undefined
    : { name: 'steering_applied', payload: { agent, text: steering.trim() } }
