/**
 * One Activity, as the registry declares it, made runnable.
 *
 * There used to be a factory per Activity — eight of them in one file, plus
 * three more for the deterministic ones — and the differences between them
 * were owner, output type, gates and what counted as acceptable. All four
 * are configuration now, so there is one factory, and adding an Activity is
 * an edit to `crust.activities.yaml` rather than a pull request here.
 *
 * Gates are NOT run from inside this. They are carried on the activity and
 * judged by the driver, because the driver is what knows whether a sibling
 * is still writing to the tree and whether there is budget left to run the
 * Activity again.
 *
 * Replay reads `{sessionDir}/{activity}/envelope.json`, which exists because
 * `executeAgent` persists an envelope the moment it parses. A missing one is
 * reported with the exact path and both ways forward, never papered over
 * with `previous: undefined`: that silence is the bug this mechanism was
 * built to close.
 */

import {
  baseRefLabel,
  changeCapture,
  changeSetEmpty,
} from '../../typedefs/changes'
import { envelopeAccepted, envelopeJudges } from '../../typedefs/envelope'
import { activityRunParams } from '../../typedefs/activity-run'
import type { TActivity, TActivityContext, TActivityOptions } from '../../typedefs/runnable-activity'
import { activityRunName } from '../../typedefs/runnable-activity'
import type { TResolvedActivity } from '../activity-registry'
import { captureChanges, changesAsEnvelope } from '../capture-changes'
import type { TAgentPorts } from '../execute-agent'
import { callAgent, liveAgent } from '../execute-agent'
import { intakeRejection, intakeViolations } from '../intake'
import { readEnvelope } from '../read-envelope'
import { selectedPaths } from '../select-range'
import { buildOutput, narrowEnvelope } from '../../typedefs/envelope'

export const DOCUMENT_NOTES =
  'Read diff_path in full before writing. Document only what the diff shows, ' +
  'then copy the write-up into app_docs/ as your task describes.'

/** What the previous activity says it changed — what a reviewer should route on. */
const claimedPaths = (ctx: TActivityContext): readonly string[] | undefined => {
  const claimed = narrowEnvelope(buildOutput, ctx.previous)?.changed_files

  return claimed !== undefined && claimed.length > 0 ? claimed : undefined
}

/**
 * What a judging Activity routes on: the named change when there is one.
 *
 * Without `--scope` this is the chain's own claim. With one, the work may be
 * committed and absent from the working tree, so the paths come from the ref
 * or range the developer named instead.
 */
const judgedPaths = (
  ctx: TActivityContext,
  base: string,
): readonly string[] | undefined =>
  base === '' ? claimedPaths(ctx) : selectedPaths(base)

/**
 * The change this run has made since its own baseline, as an envelope.
 *
 * `input: changes` is what the documenter declares: it writes up a change
 * rather than answering the Activity before it. An empty change-set throws
 * before the agent is spawned — there is nothing to document until something
 * was built, and an activity run saying so costs nothing where an agent
 * discovering it costs a context window.
 */
const capturedChanges = (ctx: TActivityContext, base: string) => {
  const captured = captureChanges(
    ctx.run,
    changeCapture({ base: ctx.baseline || base || 'main' }),
  )
  if (changeSetEmpty(captured)) {
    throw new Error(
      `nothing changed since ${baseRefLabel(captured.base)} ` +
        `(${captured.base.reason}) — this activity runs after a build.`,
    )
  }

  return captured
}

export const agentActivity = (
  activity: TResolvedActivity,
  options: TActivityOptions,
  ports: TAgentPorts = liveAgent,
): TActivity => {
  const { config, spec, gates } = activity
  const instance = activityRunName(config.name, options.instance)
  const accepted = (envelope: ReturnType<typeof Object>) =>
    envelopeAccepted(spec, envelope as never)

  return {
    name: config.name,
    instance,
    params: activityRunParams({
      name: instance,
      kind: 'agent',
      owner: config.name,
      description: config.purpose,
    }),
    requires: [config.name],
    gates,
    attempts: config.attempts,
    commit: config.commit && options.committing,

    execute: async (ctx, handle) => {
      // Intake first, and before the spawn: a context that was never usable
      // must not cost an agent call to discover. The judgement half of
      // intake is the agent's own, in its `## Intake` instruction.
      const violations = intakeViolations(ctx.previous, ctx.previousStep ?? '')
      if (violations.length > 0) {
        throw new Error(intakeRejection(violations, instance))
      }
      const captured =
        config.input === 'changes' ? capturedChanges(ctx, options.base) : undefined
      if (captured !== undefined) {
        handle.log({
          base: `${baseRefLabel(captured.base)} @ ${captured.base.commit.slice(0, 7)}`,
          reason: captured.base.reason,
          files: captured.files.length + captured.untracked.length,
          lines: `+${captured.insertions} -${captured.deletions}`,
          diff: captured.diffPath,
        })
      }
      const previous =
        captured === undefined
          ? ctx.previous
          : changesAsEnvelope(captured, DOCUMENT_NOTES)
      const changedPaths =
        captured === undefined
          ? envelopeJudges(spec)
            ? judgedPaths(ctx, options.base)
            : undefined
          : [...captured.files, ...captured.untracked]
      const envelope = await callAgent(
        ctx.run,
        handle,
        {
          outputType: spec,
          prompt: ctx.prompt,
          ...(previous === undefined ? {} : { previous }),
          upstream: ctx.upstream,
          cohort: ctx.cohort,
          feedback: ctx.feedback,
          committing: config.commit && options.committing,
          ...(changedPaths === undefined ? {} : { changedPaths }),
          ...(envelopeJudges(spec) && options.base !== ''
            ? { changeBase: options.base }
            : {}),
        },
        ports,
      )

      return { previous: envelope, accepted: accepted(envelope) }
    },

    replay: (ctx) => {
      const settled = readEnvelope(ctx.run, config.name, spec)
      if (settled.status === 'error') {
        throw new Error(
          `cannot resume activityRun '${instance}': ${settled.error.message}. ` +
            'Either drop --resume so it runs again, or run that activity on ' +
            `its own: just crust compose --activities ${config.name} --run-id ` +
            `${ctx.run.runId} "<the original request>"`,
        )
      }

      return Promise.resolve({
        previous: settled.data,
        accepted: accepted(settled.data),
      })
    },
  }
}
