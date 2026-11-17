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
 * Replay reads `{sessionDir}/envelope-history/{activity}/envelope.json`,
 * falling back to the per-agent file for older sessions. `executeAgent`
 * persists both the moment an envelope parses. A missing one is reported
 * with the exact path and both ways forward, never papered over
 * with `previous: undefined`: that silence is the bug this mechanism was
 * built to close.
 */

import type {
  TActivity,
  TActivityContext,
  TActivityOptions,
  TPiCrustConfig,
} from '../../../../lib/contracts'
import {
  activityRunName,
  activityRunParams,
  baseRefLabel,
  changeCapture,
  changeSetEmpty,
  envelopeAccepted,
  envelopeJudges,
} from '../../../../lib/contracts'
import { runChange, runChangeBase } from '../../../policy'
import {
  baseBranchProvenance,
  captureChanges,
  changesAsEnvelope,
  resolveBaseBranch,
  selectedPaths,
} from '../../../workspace'
import type { TResolvedActivity } from './activity-registry'
import type { TAgentPorts } from './execute-agent'
import { callAgent, liveAgent } from './execute-agent'
import { intakeRejection, intakeViolations } from './intake'
import { readHistoryEnvelope } from './read-envelope'
export const DOCUMENT_NOTES =
  'Read diff_path in full before writing. Document only what the diff shows, ' +
  'then copy the write-up into app_docs/ as your task describes.'

/** The named scope overrides the run's change; absent both, use the working tree. */
const judgedPaths = (
  cfg: Readonly<Pick<TPiCrustConfig, 'terminal'>>,
  base: string,
): readonly string[] | undefined =>
  base === '' ? undefined : selectedPaths(resolveBaseBranch(cfg, ''))(base)

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
  const resolved =
    ctx.baseline === '' ? resolveBaseBranch(ctx.run.cfg, base) : undefined
  const captured = captureChanges(
    ctx.run,
    changeCapture({
      base: resolved?.name ?? ctx.baseline,
      namedBy: resolved === undefined ? '' : baseBranchProvenance(resolved),
    }),
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
        config.input === 'changes'
          ? capturedChanges(ctx, options.base)
          : undefined
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
      const change =
        envelopeJudges(spec) && options.base === ''
          ? runChange(ports)(ctx.run)
          : undefined
      const changedPaths =
        change?.paths ??
        (captured === undefined
          ? envelopeJudges(spec)
            ? judgedPaths(ctx.run.cfg, options.base)
            : undefined
          : [...captured.files, ...captured.untracked])
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
          blockingFindings: options.blockingFindings,
          committing: config.commit && options.committing,
          ...(changedPaths === undefined ? {} : { changedPaths }),
          ...(change === undefined
            ? envelopeJudges(spec) && options.base !== ''
              ? { changeBase: options.base }
              : {}
            : { changeBase: runChangeBase(change.head) }),
        },
        ports,
      )

      return { previous: envelope, accepted: accepted(envelope) }
    },

    replay: (ctx, participant = config.name) => {
      const settled = readHistoryEnvelope(
        ctx.run,
        participant,
        config.name,
        spec,
      )
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
