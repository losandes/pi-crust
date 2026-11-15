/**
 * One composed workflow, start to finish — the body every activity script shares.
 *
 * A workflow built from activities is its activity list and nothing else, so the list is
 * the only thing each script declares. Everything structural — validating the
 * roster before anything spawns, minting or resuming the session, pinning the
 * baseline, recording the ask, folding the activities, settling the run — happens
 * here, once.
 *
 * Hand-written workflows still exist, and should: a conditional tail is real
 * control flow that a list of names cannot express. Those keep their own `main`
 * and call `skipIfDone` per activityRun.
 *
 * One loop is no longer among them. Every group of Activities that declare
 * `output: reviewOutput` gets the bounded revise loop before later work, so the
 * generalisation is the activity library's rather than one workflow's.
 */

import type {
  TActivityContext,
  TActivityOptions,
  TPiCrustConfig,
  TRun,
  TStage,
} from '../../../../lib/contracts'
import {
  DEFAULT_ACTIVITY_OPTIONS,
  describeTrust,
  TRUST_PROVISIONAL,
  terminalIn,
  trustLevel,
  withoutTerminal,
} from '../../../../lib/contracts'
import { dataDirFromEnv } from '../../../../lib/system'
import type { TAgentPorts } from '../../../activities'
import {
  requiredAgents,
  runnableActivities,
  terminalActivityFor,
} from '../../../activities'
import { type TResolveModel, validateAgents } from '../../../agents'
import { parseModelOverrides, type TWorkflowArgs } from '../../../cli'
import { loadConfigWithNotes } from '../../../config'
import {
  chainNote,
  plannedChain,
  plannedNames,
  unitsFrom,
} from '../../../planning'
import { readRunState, runLink, visualizerIsUp } from '../../../trace'
import { isRepo, rev, shortSha } from '../../../workspace'
import type { TAttemptLedger } from './attempts'
import { attemptLedger } from './attempts'
import type { TGateReason } from './human-gate'
import {
  parseApproveAfter,
  resumeInvocation,
  selfAnsweredIn,
  writeDecisionRequest,
} from './human-gate'
import { applyModelOverrides } from './model-overrides'
import { replayEnvelopeHistory } from './replay-envelope-history'
import type { TReviseLoopResult } from './revise-loop'
import { loopAgents } from './revise-loop'
import type { TWaiting } from './run-activities'
import { recordRequest } from './run-activities'
import { counts, finish, finishWaiting } from './run-activity-run'
import { runReviewSegments } from './run-review-segments'
import { runTerminal } from './run-terminal'
import { startSession } from './start-session'
export const NOT_ACCEPTED =
  'a activity did not meet its own criterion — a check failed, or a review was ' +
  'not approved. The activityRuns all ran; the work is what did not pass.'

/**
 * What this session has already spent, by instance name.
 *
 * Superseded rows are excluded, because they are the ones a person steered
 * — human-directed re-execution is not an attempt. A run joined with
 * `--run-id` and no `--resume` carries this: it re-runs the chain in the
 * same trace, so it starts with what that trace already spent. A run
 * started with `--resume` does not — see `ledgerSeed`.
 */
export const spentAlready = (
  cfg: TPiCrustConfig,
  runId: string | undefined,
): readonly string[] => {
  if (runId === undefined) {
    return []
  }
  const state = readRunState(cfg.observability.db, runId)

  return (state?.activityRuns ?? [])
    .filter(
      (activityRun) => activityRun.kind === 'agent' && counts(activityRun),
    )
    .map((activityRun) => activityRun.name)
}

/**
 * What the attempt ledger starts with.
 *
 * `--resume` starts it EMPTY. A resume is a person deciding to go again,
 * and a person's decision is not an attempt — the same rule `attempts.ts`
 * already states for a steer. The ceiling still binds everything the RUN
 * decides for itself inside this process; what it no longer does is hand a
 * picked-up run a budget that was spent before the developer fixed what
 * broke, which left the first gate failure with nowhere to go.
 *
 * Joining a session with `--run-id` and no `--resume` is not that decision:
 * it re-runs the chain in the same trace, so it carries what that trace
 * already spent.
 */
export const ledgerSeed = (
  cfg: TPiCrustConfig,
  runId: string | undefined,
  resuming: boolean,
): readonly string[] => (resuming ? [] : spentAlready(cfg, runId))

/**
 * HEAD before this run commits anything, for the documenter's diff.
 *
 * Only pinned when a activity needs it: a repository with no commit yet cannot
 * resolve HEAD, and a chain that never documents should not fail on that.
 */
export const pinBaseline = (names: readonly string[]): string =>
  names.includes('document') && isRepo() ? rev('HEAD') : ''

/**
 * Run the chain an operator planned, inside the run that planned it.
 *
 * Returns `undefined` when a planned activity stopped for a person — the caller
 * settles the run as waiting, and a resume replays the operator activityRun from
 * the trace and picks the chain up where it stopped.
 */
const settlePlannedChain = async (
  run: TRun,
  planned: readonly string[],
  options: Readonly<Partial<TActivityOptions>>,
  ctx: TActivityContext,
  args: TWorkflowArgs,
  trust: number,
  ledger: TAttemptLedger,
  /** see `runWorkflow`'s own parameter of the same name */
  agentPorts?: TAgentPorts,
  /** see `runWorkflow`'s own parameter of the same name */
  resolveModel?: TResolveModel,
): Promise<TReviseLoopResult | undefined> => {
  const activities = runnableActivities(planned, run.cfg, options, agentPorts)
  validateAgents(
    run.cfg,
    [
      ...new Set([
        ...requiredAgents(activities),
        ...loopAgents(run.cfg, planned),
      ]),
    ],
    resolveModel,
  )
  run.console.note(chainNote(planned))

  /*
   * Below the provisional threshold, an agent does not get to spend your
   * budget on a chain you have not seen.
   *
   * This is the trust dial applied to the one decision the dial did not
   * previously reach: every other stage asks about what it could not
   * establish, and this one asks about what it intends to DO. It is checked
   * here rather than requested in the operator's prompt, because a prompt
   * can ask an agent to flag its plan and only code can guarantee it —
   * exactly the argument that put `steps_valid` in a gate.
   *
   * Exempt once replayed, for the reason the stage gate is: the person
   * already approved this chain, and that approval is why the run is running
   * again. Asking a second time is the approve-resume-replay-approve loop.
   */
  if (trust < TRUST_PROVISIONAL && !run.resume.has('operator')) {
    const reason: TGateReason = {
      kind: 'plan',
      activity: 'operator',
      activities: planned,
    }
    const path = writeDecisionRequest(
      run.contextHandoffDir,
      reason,
      run.runId,
      resumeInvocation(process.argv, run.runId),
    )
    run.console.note(
      `waiting for you: the operator chose a chain it has not run — ${path}`,
    )
    run.tracer.event({
      run_id: run.runId,
      activity_run_id: '',
      type: 'log',
      name: 'human_gate_open',
      payload: {
        activity: 'operator',
        kind: 'plan',
        request: path,
        activities: planned,
      },
    })
    return undefined
  }

  let stopped: TWaiting | undefined
  const after = await runReviewSegments({
    run,
    names: planned,
    options,
    fallbackReason: NOT_ACCEPTED,
    ...(agentPorts === undefined ? {} : { agentPorts }),
    units: activities.map((activity) => ({
      stage: activity.name,
      strategy: 'serial' as const,
      activities: [activity],
      endsStage: true,
    })),
    start: ctx,
    approveAfter: parseApproveAfter(args.approveAfter),
    onWaiting: (waiting) => {
      stopped = waiting
    },
    trust,
    ledger,
  })
  return stopped === undefined ? after : undefined
}

/** Preserve the context-only entry point used by callers running a planned chain. */
export const runPlannedChain = async (
  ...params: Readonly<Parameters<typeof settlePlannedChain>>
): Promise<TActivityContext | undefined> =>
  (await settlePlannedChain(...params))?.ctx

export const runWorkflow = async (
  args: TWorkflowArgs,
  plan: readonly TStage[],
  /**
   * Defaults to `agentActivity`'s own `liveAgent`. No real caller passes
   * anything else \u2014 this exists so a test can drive an actually-executed
   * (not merely replayed) Activity Run through a canned, in-process
   * response, the seam COVERAGE-AGENT-PORTS.md built and said this file
   * would go on to consume.
   */
  agentPorts?: TAgentPorts,
  /**
   * Defaults to the pi catalogue on this machine. Same reason as
   * `agentPorts`: validating a model pattern shells out to
   * `pi --list-models`, and a test that drives a whole workflow should not
   * need a pi install to be told its own fixture's model exists.
   */
  resolveModel?: TResolveModel,
  /**
   * Whether a visualizer is listening, defaulted to a real probe of this
   * machine's port.
   *
   * Injected for the same reason as the two above, and found the same way:
   * the probe makes the run take a different path on a developer with the
   * visualizer open than on one without, so the suite covered a branch on
   * one machine and not on another, and no test could choose.
   */
  visualizerUp: (port: number) => Promise<boolean> = (port) =>
    visualizerIsUp(process.env, fetch, port),
): Promise<number> => {
  /*
   * A terminal Activity never enters the fold — it is wired to run once the
   * chain has settled, after runReviseLoop and before finish, outside the
   * Stages that get folded. Removed here, before anything downstream (the
   * names list, the attempt ledger, reviewGroups) ever sees it.
   */
  const terminalName = terminalIn(plan)
  const foldPlan = withoutTerminal(plan)
  const names = plannedNames(foldPlan)
  const loaded = loadConfigWithNotes(args.config)
  const options: Readonly<Partial<TActivityOptions>> = {
    ...(args.base === undefined ? {} : { base: args.base }),
    committing: args.commit !== 'false',
  }
  const configuredActivities = runnableActivities(
    names,
    loaded.config,
    options,
    agentPorts,
  )
  // Every agent the run can spawn: the chain's activities, the revisers the
  // revise loop re-runs, and the terminal activity. A reviser is the writer
  // before its review group, so it is already a chain activity. Overrides are
  // judged against this set and every model in it is validated before the
  // first activity starts.
  const used = new Set([
    ...requiredAgents(configuredActivities),
    ...loopAgents(loaded.config, names),
    ...(terminalName === undefined ? [] : [terminalName]),
  ])
  const parsed =
    args.models === undefined
      ? { overrides: [], warnings: [] }
      : parseModelOverrides(args.models)
  const overridden = applyModelOverrides(loaded.config, parsed.overrides, used)
  const cfg = overridden.config
  const activities =
    cfg === loaded.config
      ? configuredActivities
      : runnableActivities(names, cfg, options, agentPorts)
  const terminalOptions: TActivityOptions = {
    ...DEFAULT_ACTIVITY_OPTIONS,
    ...options,
  }
  const terminal =
    terminalName === undefined
      ? undefined
      : terminalActivityFor(terminalName, cfg, terminalOptions)
  validateAgents(cfg, [...used], resolveModel)
  const ledger = attemptLedger(
    ledgerSeed(cfg, args.runId, args.resume === true),
  )
  const trust = trustLevel(args.trustLevel)
  const run = startSession(cfg, args.runId, {
    resume: args.resume,
    stream: args.stream,
    trust,
    // What the run was asked for, so the session says `sdlc` rather than
    // `compose` — the script that happened to run it.
    lifecycle: args.lifecycle,
    handoff: args.handoff,
    name: args.name,
  })
  /*
   * From here the session row says `running`, so every exit has to say
   * otherwise — including a throw.
   *
   * A run that dies after `startSession` and before `finish` leaves a
   * session claiming to be running with nothing running, and the interface
   * believes it indefinitely. Observed: a resume died in startup parsing
   * its own stored envelope, and the run read as live for the rest of the
   * day. The error is still rethrown; this only makes the trace agree with
   * reality before it leaves.
   */
  // biome-ignore lint/plugin: this layer owns the boundary and rethrows
  try {
    /*
     * The ask, as this process received it, before a token is spent on it.
     *
     * A prompt is pasted into a shell, and the shell gets a vote: an embedded
     * double quote truncates it, a backtick runs it. Printed here, the damage
     * is visible while killing the run still costs nothing; discovered from
     * behaviour, it costs the run.
     */
    run.console.promptReceived(args.prompt)
    /*
     * Said on every run, including the default one.
     *
     * This used to be silent at the default because the default asked about
     * everything consequential — silence meant "nothing is being decided for
     * you". The default now answers reversible questions on its own, and a run
     * that quietly does that is a run whose report of self-answered decisions
     * arrives as a surprise at the end.
     */
    /*
     * Said out loud, because the file is gitignored and therefore invisible to
     * everyone except the person it belongs to. A run whose models or writes
     * boundaries differ from the committed roster, with nothing on screen
     * saying so, is a run whose trace cannot be compared with anyone else's.
     */
    if (loaded.localPath !== '') {
      run.console.note(
        `local config in force: ${loaded.localPath} (not in git)`,
      )
    }
    if (loaded.machinePath !== '') {
      run.console.note(
        `machine config in force: ${loaded.machinePath} (not in git, not this repository)`,
      )
    }
    for (const warning of loaded.warnings) {
      run.console.note(warning)
    }
    for (const warning of [...parsed.warnings, ...overridden.warnings]) {
      run.console.note(warning)
    }
    /*
     * 1.1.8: a run whose resolved data_dir did not come from this
     * repository's own crust.config.yaml says so, once, at run start — the
     * provenance a developer needs to tell "my repository put it here" from
     * "the machine layer or CRUST_DATA_DIR put it somewhere else".
     */
    if (loaded.machinePath !== '' || dataDirFromEnv() !== undefined) {
      run.console.note(
        `data_dir resolved to ${run.sessionDir.replace(/\/sessions\/.*$/, '')}` +
          ` — set by ${dataDirFromEnv() === undefined ? loaded.machinePath : 'CRUST_DATA_DIR'}`,
      )
    }

    run.console.note(describeTrust(trust))
    /*
     * Where to watch it, when there is somewhere to watch. Probed rather than
     * assumed: a link to a port nothing is listening on teaches a reader to
     * ignore the next hint too.
     */
    const ports = cfg.observability.ports
    if (await visualizerUp(ports.backend)) {
      run.console.instructions([
        `watch: ${runLink(run.runId, process.env, ports.frontend)}`,
      ])
    }

    const baseline = pinBaseline(names)

    const wholeChain = [
      ...names,
      ...(terminal === undefined ? [] : [terminal.name]),
    ]
    await recordRequest(
      run,
      args.prompt,
      baseline === ''
        ? { activities: wholeChain.join(' -> ') }
        : { activities: wholeChain.join(' -> '), baseline: shortSha(baseline) },
    )

    const units = unitsFrom(foldPlan, activities)
    const start: TActivityContext = {
      run,
      prompt: args.prompt,
      previous: undefined,
      previousStep: undefined,
      upstream: [],
      cohort: [],
      baseline,
      outcomes: [],
      feedback: [],
      ...(args.resume ? replayEnvelopeHistory(run, units) : {}),
    }
    // `let` is deliberate and contained: the callback fires inside the fold,
    // and threading an out-parameter through every activity for one optional
    // outcome would be worse than a single assignment nothing else can see.
    let waiting: TWaiting | undefined
    const initial = await runReviewSegments({
      run,
      units,
      names,
      options,
      fallbackReason: NOT_ACCEPTED,
      ...(agentPorts === undefined ? {} : { agentPorts }),
      start,
      approveAfter: parseApproveAfter(args.approveAfter),
      onWaiting: (stopped) => {
        waiting = stopped
      },
      trust,
      ledger,
    })
    if (waiting !== undefined) {
      return finishWaiting(run, waiting.path)
    }

    /*
     * An operator chose the chain: run it, here, in this run.
     *
     * It continues the same session rather than starting another, because the
     * plan and the work it caused belong in one trace — a reader asking "why
     * these activities" must find the answer beside them, not in a sibling run.
     *
     * Agents are revalidated before anything spawns, exactly as they are for a
     * named chain. The whole point of validating up front is that a chain never
     * dies three stages in on a missing agent, and a chain chosen at runtime
     * would lose that guarantee if it were skipped here.
     */
    const planned = plannedChain(initial.ctx)
    const settled =
      planned.length === 0 ||
      initial.outcome === 'deadlocked' ||
      initial.outcome === 'exhausted'
        ? initial
        : await settlePlannedChain(
            run,
            planned,
            options,
            initial.ctx,
            args,
            trust,
            ledger,
            agentPorts,
            resolveModel,
          )
    if (settled === undefined) {
      return finishWaiting(run, run.contextHandoffDir)
    }

    /*
     * The bargain of a raised dial, collected in one place.
     *
     * Each self-answered question was already said as it happened, but a line
     * in the middle of a nine-stage run is a line nobody scrolls back to. This
     * is the part a reader is owed: here is what nobody reviewed, and here is
     * what the chain decided instead.
     */
    const decided = selfAnsweredIn(run, trust)
    if (decided.length > 0) {
      run.console.instructions([
        `${decided.length} question(s) this run answered for itself (trust ${trust}):`,
        '',
        ...decided.flatMap((entry) => [
          `  ${entry.activity}: ${entry.question}`,
          `      → ${entry.answer}`,
        ]),
      ])
    }

    if (terminal !== undefined) {
      await runTerminal({
        run,
        activity: terminal,
        ctx: settled.ctx,
        accepted: settled.accepted,
      })
    }

    return finish(run, { accepted: settled.accepted, reason: settled.reason })
  } catch (error) {
    run.tracer.sessionFinish(run.runId, false)
    run.tracer.processesEndAll(run.runId)
    throw error
  }
}
