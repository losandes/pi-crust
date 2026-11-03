/**
 * One agent call: render prompts -> pi run -> typed parse -> gates -> envelope.
 *
 * Parse failures and gate violations re-prompt the SAME session with a
 * correction — context intact, bounded retries. Agent proposes, code disposes.
 */

import { join, resolve } from 'node:path'
import {
  errorMessage,
  safeParseSettlement,
} from '../../../lib/typedefs/src/settlement'
import { ensureDir, writeText } from '../data/files'
import { newId } from '../data/ids'
import { inboxSince } from '../data/inbox'
import type { TPiHooks } from '../data/pi-agent'
import * as piAgent from '../data/pi-agent'
import { resolveReference } from '../data/prompt-files'
import type { TRoots } from '../data/roots'
import { readSteering } from '../data/steering'
import type { TTreeSnapshot } from '../data/working-tree'
import type { TActivityRun } from '../typedefs/activity-run'
import type { TAgentConfig } from '../typedefs/config'
import type { TEnvelopeBase, TEnvelopeSpec } from '../typedefs/envelope'
import type { TAgentCall } from '../typedefs/gate'
import type { TPiRequest, TPiResult, TUsageBreakdown } from '../typedefs/pi'
import { emptyUsage, mergeUsage } from '../typedefs/pi'
import type { TActivityRunHandle, TRun } from '../typedefs/run'
import { trustStance } from '../typedefs/trust'
import type { TTreeWarning } from '../typedefs/warning'
import { WARNING_EVENT, warningPayload } from '../typedefs/warning'
import { activityCatalogue } from './activity-catalogue'
import { enforcePermissions, handoffDocument } from './enforce-permissions'
import { liveAgent } from './execute-agent-live'
import { extractJson } from './extract-json'
import { resolveAgent } from './load-config'
import { claimedPaths, observedPayload, PATHS_TOUCHED } from './observed-paths'
import { refusalLine } from './path-policy'
import { armPolicy, refusalsIn, stopMessage } from './path-policy-run'
import { matchingSkills } from './route-by-path'
import { steeringAppliedEvent, steeringBlock } from './steer'

/**
 * What a gate said about the LAST attempt, appended to this one's prompt.
 *
 * Appended rather than rendered from a placeholder, for the reason steering
 * is: a `{{feedback}}` variable would be opt-in, and an Activity whose
 * prompt forgot the placeholder would run again knowing nothing about why
 * its first attempt was rejected — the same call, at the same price, with
 * the same result.
 */
export const feedbackBlock = (violations: readonly string[]): string =>
  violations.length === 0
    ? ''
    : '\n\n## What failed last time\n\n' +
      "Your previous attempt was rejected by this repository's gates:\n\n" +
      `${violations.map((one) => `- ${one}`).join('\n')}\n\n` +
      'Fix every one of them. They are checked again, the same way, when ' +
      'you are done.'

/** continue-with-correction attempts for malformed JSON */
export const JSON_FIX_ATTEMPTS = 2

/**
 * The extension every agent is given, which refuses a governed path before
 * the tool runs. Named relative to the package, like every other reference.
 */
export const PATH_POLICY_EXTENSION = 'harness-engineering/path-policy.ts'

/**
 * Everything one agent call reaches outside this process, following
 * `TDeliveryPorts` / `liveDelivery` in `gh-pull-request.ts`.
 *
 * Ports on the function rather than fields on `TRun` (1.1.5): `TRun` is
 * passed through every layer and faked with `as unknown as TRun` in several
 * existing tests, and only this one call actually spawns an agent.
 */
export type TAgentPorts = Readonly<{
  run: (request: TPiRequest, hooks?: TPiHooks) => Promise<TPiResult>
  /** uncommitted paths; the real implementation reads the process cwd */
  changed: () => readonly string[]
  /** untracked paths; the real implementation reads the process cwd */
  untracked: () => readonly string[]
  render: (
    templatePath: string,
    variables: Readonly<Record<string, string>>,
  ) => string
  savePrompt: (directory: string, name: string, content: string) => string
  /** the working tree's own fingerprint; the real implementation reads disk */
  snapshot: (roots: TRoots) => TTreeSnapshot
  /**
   * HEAD's revision; '' when the process cwd is not (yet) a git repository.
   * The real implementation reads the process cwd.
   */
  rev: (ref: string) => string
}>

/**
 * The real adapters, moved to `execute-agent-live.ts` and re-exported here
 * so every existing importer compiles unchanged — see COVERAGE-GATE-POLICY.md
 * and the module comment on `execute-agent-live.ts` for why.
 */
export { liveAgent }

const agentSessionId = (run: TRun, agent: TAgentConfig): string => {
  const entry = run.agentMap()[agent.name]
  // rejoin the existing context window
  return entry && entry.model === agent.model
    ? entry.session_id
    : `crust-${run.runId}-${agent.name}-${newId(4)}`
}

/** One tool_call event per real tool call, with its exact args and result. */
/**
 * Turns the agent's stream into trace rows.
 *
 * Two trackers, one turn counter. Narration and tool calls are stamped with
 * the same turn number so a reader can see which calls a passage of thinking
 * produced — adjacency in time cannot answer that, because two agents' events
 * interleave in one trace.
 *
 * `--stream` echoes narration to the terminal as it arrives. It is off by
 * default: an unattended run writing a model's reasoning to stdout buries the
 * one line that said what went wrong.
 */
/** How often a running activityRun checks whether anybody has said anything. */
export const INBOX_POLL_MS = 1_000

const eventForwarder = (
  run: TRun,
  activityRun: TActivityRun,
  agentName: string,
  stream: boolean,
) => {
  const tools = piAgent.createToolCallTracker()
  const narration = piAgent.createNarrationTracker()

  const traceNarration = (record: piAgent.TNarrationRecord | undefined) => {
    if (record === undefined) return
    if (stream) run.console.narrate(agentName, record.channel, record.text)
    const { text, started_at, ended_at, ...rest } = record
    run.tracer.event({
      run_id: run.runId,
      activity_run_id: activityRun.activity_run_id,
      type: 'narration',
      name: `${agentName} ${rest.channel}`,
      started_at,
      ended_at,
      payload: { ...rest, text, agent: agentName },
    })
  }

  const observe = (event: Readonly<Record<string, unknown>>): void => {
    traceNarration(narration.observe(event))

    const record = tools.observe(event)
    if (record === undefined) {
      return
    }
    // The call's span rides the columns; duration_ms stays in the payload as
    // pi's own authoritative number.
    const { label, started_at, ended_at, ...payload } = record
    run.tracer.event({
      run_id: run.runId,
      activity_run_id: activityRun.activity_run_id,
      type: 'tool_call',
      name: label,
      ...(started_at === undefined ? {} : { started_at }),
      ended_at,
      payload: { ...payload, agent: agentName, turn: narration.turn() },
    })
  }

  return {
    observe,
    // Whatever the agent was mid-sentence on when it exited still happened.
    close: () => traceNarration(narration.flush()),
  }
}

const persistEnvelope = (
  run: TRun,
  activityRun: TActivityRun,
  agentName: string,
  spec: TEnvelopeSpec<TEnvelopeBase>,
  envelope: TEnvelopeBase | undefined,
  valid: boolean,
  raw = '',
): void => {
  const payloadJson = envelope
    ? JSON.stringify(envelope, null, 2)
    : JSON.stringify({ raw: raw.slice(-2000) })
  run.tracer.envelopeRow(activityRun, agentName, spec.name, payloadJson, valid)
  if (envelope) {
    writeText(
      join(run.sessionDir, agentName, 'envelope.json'),
      `${JSON.stringify(
        {
          agent_name: agentName,
          purpose: resolveAgent(run.cfg, agentName).purpose,
          output_type: spec.name,
          ...envelope,
        },
        null,
        2,
      )}\n`,
    )
  }
}

type TSend = (promptText: string) => Promise<TPiResult>

type TParsed = Readonly<{ envelope: TEnvelopeBase; attempt: number }>

/**
 * Parse the final response against the declared output type; on failure,
 * continue the SAME session with a correction (bounded).
 */
const parseWithRetries = (
  run: TRun,
  activityRun: TActivityRun,
  spec: TEnvelopeSpec<TEnvelopeBase>,
  first: TPiResult,
  send: TSend,
): Promise<TParsed> => {
  const attempt = async (
    result: TPiResult,
    round: number,
  ): Promise<TParsed> => {
    const settled = safeParseSettlement(() =>
      spec.schema.parse(extractJson(result.text)),
    )
    if (settled.status === 'ok') {
      // Persisted the MOMENT it parses, not after the gates rule on it. A
      // terminal gate failure used to lose the envelope entirely, so a later
      // activityRun resuming the session had no previous_envelope to read — the
      // agent's work was on disk and its report was not.
      persistEnvelope(
        run,
        activityRun,
        activityRun.params.owner,
        spec,
        settled.data,
        true,
      )
      return { envelope: settled.data, attempt: round }
    }
    const reason = errorMessage(settled.error)
    persistEnvelope(
      run,
      activityRun,
      activityRun.params.owner,
      spec,
      undefined,
      false,
      result.text,
    )
    if (round > JSON_FIX_ATTEMPTS) {
      throw new Error(
        `${activityRun.params.owner} never produced valid ${spec.name} JSON: ${reason}`,
      )
    }
    run.console.retry(
      activityRun.params.owner,
      round,
      JSON_FIX_ATTEMPTS,
      `invalid ${spec.name} JSON: ${reason}`,
    )
    const corrected = await send(
      'Your response was not valid JSON for the required structure ' +
        `(${reason}). Respond again with ONLY a JSON object with these ` +
        `fields: ${spec.fieldNames.join(', ')}. No prose, no code fences.`,
    )
    return attempt(corrected, round + 1)
  }
  return attempt(first, 1)
}

/**
 * What a workflow calls inside an agent activityRun. Valid in that activityRun only — a
 * code or engineer activityRun that spawns an agent would render in the wrong lane
 * and hide the spend.
 */
export const callAgent = <TEnvelope extends TEnvelopeBase>(
  run: TRun,
  handle: TActivityRunHandle,
  call: TAgentCall<TEnvelope>,
  ports: TAgentPorts = liveAgent,
): Promise<TEnvelope> => {
  if (handle.activityRun.params.kind !== 'agent') {
    throw new Error('callAgent() is only valid inside an agent activity-run')
  }
  return executeAgent(run, handle.activityRun, call, ports)
}

export const executeAgent = async <TEnvelope extends TEnvelopeBase>(
  run: TRun,
  activityRun: TActivityRun,
  call: TAgentCall<TEnvelope>,
  ports: TAgentPorts = liveAgent,
): Promise<TEnvelope> => {
  const agent = resolveAgent(run.cfg, activityRun.params.owner)
  const agentDir = ensureDir(join(run.sessionDir, agent.name))
  const spec = call.outputType as unknown as TEnvelopeSpec<TEnvelopeBase>
  /*
   * The path policy, armed before anything spawns.
   *
   * Loaded into EVERY agent rather than declared per roster entry: a
   * protection an Activity can decline by saying nothing is not a
   * protection. It is the only check in this system that runs before the
   * call instead of after it, which is the only way to answer for a secret
   * — bytes that have been read cannot be unread.
   */
  const policy = armPolicy({
    cfg: run.cfg,
    repoRoot: run.repoRoot,
    handoffDir: run.contextHandoffDir,
    agentDir,
    activityRunId: activityRun.activity_run_id,
  })

  // What this agent is being asked to reason about, as paths. A caller that
  // already knows (a reviewer handed the builder's envelope) says so; otherwise
  // it is whatever the working tree currently has uncommitted.
  const changedPaths =
    call.changedPaths ??
    [...ports.changed(), ...ports.untracked()].toSorted().filter(Boolean)
  const skills = matchingSkills(
    run.cfg,
    agent.name,
    changedPaths,
    activityRun.params.name,
  )

  const variables = {
    prompt: call.prompt,
    previous_envelope: call.previous
      ? JSON.stringify(call.previous, null, 2)
      : '(none)',
    /*
     * Everything upstream, not just the first of it.
     *
     * A concurrent Stage hands several envelopes forward, and
     * `previous_envelope` can only carry one. Rendering the rest here — each
     * labelled with the Activity that produced it — is what stops a
     * downstream agent from silently judging half the work. Identical to
     * `previous_envelope` in the ordinary single-upstream case, so a prompt
     * may use either.
     */
    previous_envelopes:
      (call.upstream ?? []).length > 0
        ? (call.upstream ?? [])
            .map(
              (one) =>
                `## from ${one.activity}\n\n${JSON.stringify(one.envelope, null, 2)}`,
            )
            .join('\n\n')
        : '(none)',
    context_handoff_dir: resolve(run.contextHandoffDir),
    /*
     * Where this agent's own document goes, from its `writes`. Prompts used
     * to hardcode the filename, which meant the path the agent was told and
     * the path it was permitted to write were two separate declarations that
     * could disagree — and redirecting an Activity's output meant forking its
     * prompt.
     */
    output_document:
      handoffDocument(agent.writes, run.repoRoot, run.contextHandoffDir) ??
      resolve(run.contextHandoffDir),
    // Named, never hardcoded: a prompt says "load every skill listed here",
    // and the config decides what that list contains.
    //
    // An empty list means nothing was PRIMED, never that the agent has no
    // conventions: pi discovers this repository's skills either way, because
    // `-ns` is never passed. Rendering a bare `(none)` here once convinced a
    // code reviewer it had no conventions to apply, and it declined to rule.
    skills:
      skills.length > 0
        ? skills.join('\n')
        : '(none pre-loaded — every skill in this repository is still ' +
          'discoverable, and you are expected to reach for the ones that apply)',
    changed_files: changedPaths.length > 0 ? changedPaths.join('\n') : '(none)',
    // What the call is ABOUT, which is not always what is in the working tree:
    // a committed range is absent from it, and the agent has to be told to go
    // and read it rather than conclude nothing was done.
    change_base: call.changeBase ?? '(the uncommitted working tree)',
    /*
     * Only the operator substitutes this, and it is generated from the activity
     * registry and the roster rather than written into its prompt. Every
     * other agent renders it to nothing, because `render` leaves an unused
     * variable alone — the cost of computing it for all of them is a string
     * nobody reads, and the alternative is a conditional here that knows
     * which agent is which.
     */
    step_catalogue: activityCatalogue(run.cfg.activities),
    /*
     * The dial, in words, to every agent.
     *
     * It was never sent at all: the level filtered the agent's answers after
     * the fact, so an agent could not know whether escalating would stop the
     * run or merely be logged, and raising the dial could not make it try
     * harder to settle anything. A setting the worker cannot see is not a
     * setting, it is a report filter.
     */
    trust_stance: trustStance(run.trust),
  }
  const systemText = ports.render(agent.prompt_engineering.system, variables)
  /*
   * Steering is APPENDED, not rendered from a placeholder.
   *
   * A `{{steering}}` variable would be opt-in, and a run sent back with new
   * instructions where one agent's prompt forgot the placeholder is a run
   * that silently ignored the person. Every activity from the branch point
   * onward has to hear it, so no prompt gets a say in whether it does.
   */
  const steering = readSteering(run.contextHandoffDir)
  const userText = `${ports.render(agent.prompt_engineering.user, variables)}${steeringBlock(
    steering,
  )}${feedbackBlock(call.feedback ?? [])}`
  ports.savePrompt(join(agentDir, 'prompts'), 'system.md', systemText)
  ports.savePrompt(join(agentDir, 'prompts'), 'user.md', userText)

  /*
   * Filed once per activity run, not once per send: a parse retry or a gate
   * correction re-enters the same session with the same steering already
   * applied, and filing it again would make one instruction look like two.
   */
  const appliedEvent = steeringAppliedEvent(agent.name, steering)
  if (appliedEvent !== undefined) {
    run.tracer.event({
      run_id: run.runId,
      activity_run_id: activityRun.activity_run_id,
      type: 'log',
      name: appliedEvent.name,
      payload: appliedEvent.payload,
    })
  }

  const sessionId = agentSessionId(run, agent)
  run.tracer.event({
    run_id: run.runId,
    activity_run_id: activityRun.activity_run_id,
    type: 'agent_start',
    name: agent.name,
    payload: {
      model: agent.model,
      thinking: agent.thinking,
      color: agent.color,
      session_id: sessionId,
      coding_agent: agent.coding_agent,
      purpose: agent.purpose,
      skills,
      changed_paths: changedPaths.length,
      change_base: call.changeBase ?? '',
      tools: agent.tools ?? null, // null = all tools
      harness_engineering: agent.harness_engineering,
    },
  })
  run.console.agentStarted(agent.name, agent.model, sessionId)

  // Parse retries and gate corrections re-enter the SAME pi session, so the
  // last send is the one whose context occupancy is current — while spend is
  // the opposite: every send costs, so usage accumulates across all of them.
  let latest: TPiResult | undefined
  let spent: TUsageBreakdown = emptyUsage

  /*
   * One forwarder for the whole activityRun, not one per send. Turn numbers have to
   * keep climbing across a parse retry or a gate correction — those re-enter
   * the SAME pi session, so restarting the count would make two different
   * passages of thinking claim the same turn and attract each other's calls.
   */
  const forwardEvents = eventForwarder(run, activityRun, agent.name, run.stream)

  /*
   * Someone outside this process may want to say something to the agent while
   * it works. They cannot reach the child directly, so they append to the
   * run's inbox and this polls it — the only shared surface a web app, a
   * second terminal and this process all have.
   *
   * Polling rather than watching: a watcher is one more thing to leak when a
   * activityRun ends badly, and a second of latency on a message a human just typed
   * is not worth a file descriptor and a cleanup path.
   */
  const deliverFromInbox = (control: piAgent.TPiControl): (() => void) => {
    let consumed = inboxSince(run.sessionDir, 0).consumed
    const timer = setInterval(() => {
      const batch = inboxSince(run.sessionDir, consumed)
      consumed = batch.consumed
      for (const entry of batch.messages) {
        run.console.note(
          entry.kind === 'abort'
            ? `${entry.from} aborted this activityRun`
            : `${entry.from} ${entry.kind === 'steer' ? 'steered' : 'queued a follow-up'}: ${entry.message}`,
        )
        run.tracer.event({
          run_id: run.runId,
          activity_run_id: activityRun.activity_run_id,
          type: 'log',
          name: `inbox_${entry.kind}`,
          payload: { ...entry, agent: agent.name },
        })
        if (entry.kind === 'steer') control.steer(entry.message)
        else if (entry.kind === 'follow_up') control.followUp(entry.message)
        else control.abort()
      }
    }, INBOX_POLL_MS)
    return () => clearInterval(timer)
  }
  let stopDelivery: () => void = () => undefined

  const send: TSend = async (promptText) => {
    const result = await ports.run(
      {
        prompt: promptText,
        systemPrompt: systemText,
        model: agent.model,
        thinking: agent.thinking,
        sessionId,
        // absolute: read by the pi subprocess, which runs in repoRoot
        sessionDir: resolve(join(agentDir, 'pi_sessions')),
        rawOutputPath: resolve(join(agentDir, 'raw_output.jsonl')),
        tools: agent.tools,
        /*
         * Resolved here, not handed over as written: pi opens an extension
         * relative to ITS cwd, which is the repository being worked on, and
         * the extensions ship with the package rather than with the stamp.
         */
        extensions: [
          resolveReference(PATH_POLICY_EXTENSION),
          ...agent.harness_engineering.map(resolveReference),
        ],
        skills,
        cwd: run.repoRoot,
        env: policy.env,
      },
      {
        onEvent: forwardEvents.observe,
        onControl: (control) => {
          stopDelivery = deliverFromInbox(control)
        },
        onSpawn: (pid) =>
          run.tracer.processStart(
            run.runId,
            'agent',
            agent.name,
            pid,
            `${agent.coding_agent} ${agent.name} ${agent.model}`,
          ),
        onExit: (pid) => run.tracer.processEnd(run.runId, pid),
      },
    )
    // Whatever the agent was mid-sentence on when the stream ended.
    stopDelivery()
    forwardEvents.close()
    run.addUsage(result.tokens, result.cost)
    spent = mergeUsage(spent, result.usage)
    latest = result
    return result
  }

  // What the tree looked like before this agent got its hands on it. Every
  // send in this activityRun — first prompt, JSON retries — is measured against
  // this one baseline.
  const treeBefore = ports.snapshot({
    workspaceRoot: run.repoRoot,
    vcsRoot: run.vcsRoot,
  })
  /*
   * And where history was, so a commit this Activity was not asked to make is
   * caught. No prompt asks an agent to commit, but a prompt is advice:
   * without this, `--commit false` would stop the engine while leaving an
   * agent free to commit with `bash`, and the run would be reported as having
   * made no commits while carrying one.
   */
  const headBefore = ports.rev('HEAD')

  const parsed = parseWithRetries(
    run,
    activityRun,
    spec,
    await send(userText),
    send,
  )

  const { envelope } = await parsed

  // What the Activity Run did to the repository, read after every send is
  // done: the agent is finished, so the tree it leaves is the one to compare.
  // Observed, never acted on — see enforce-permissions for why nothing here
  // puts a file back.
  const observed = enforcePermissions(
    run,
    agent,
    {
      tree: treeBefore,
      head: headBefore,
      committing: call.committing === true,
    },
    /*
     * Resolved from the roster rather than carried: a cohort is Activity
     * names, and what enforcement needs is what those Activities declared.
     * A name the roster does not have contributes nothing, which is right
     * — an unknown agent cannot be made responsible for a path.
     */
    (call.cohort ?? []).flatMap((name) => {
      const sibling = run.cfg.agents.find((one) => one.name === name)

      return sibling === undefined ? [] : [sibling]
    }),
  )
  /*
   * The observation, filed whole: what changed, what was already changing,
   * and what the Activity said it changed. The commit scope reads the first,
   * and the comparison that raises a warning needs all three.
   */
  if (observed.touched.length > 0) {
    run.tracer.event({
      run_id: run.runId,
      activity_run_id: activityRun.activity_run_id,
      type: 'log',
      name: PATHS_TOUCHED,
      payload: observedPayload({
        activity: activityRun.params.name,
        activityRunId: activityRun.activity_run_id,
        agent: agent.name,
        touched: observed.touched,
        dirtyBefore: observed.dirtyBefore,
        claimed: claimedPaths(run.repoRoot, envelope),
      }),
    })
  }
  /*
   * Every governed call this agent made, as the extension recorded it.
   *
   * `block` already happened inside the harness — nothing was read and
   * nothing was written, which is what makes it the only verb that
   * protects. `warn` and `stop` let the call run, so the run answers for
   * them here: both are reported, and `stop` ends the Activity.
   */
  const refusals = refusalsIn(policy.refusals)
  if (refusals.length > 0) {
    const refusal: TTreeWarning = {
      kind: 'refusal',
      activities: [activityRun.params.name],
      activityRunIds: [activityRun.activity_run_id],
      stage: activityRun.params.name,
      paths: refusals.map(refusalLine),
      note: `${agent.name} reached ${refusals.length} governed path(s)`,
    }
    run.console.note(
      `${activityRun.params.name}: ${refusals.length} tool call(s) governed ` +
        'by the path policy',
    )
    run.tracer.event({
      run_id: run.runId,
      activity_run_id: activityRun.activity_run_id,
      type: 'log',
      name: WARNING_EVENT,
      payload: warningPayload(refusal),
    })
    run.tracer.event({
      run_id: run.runId,
      activity_run_id: activityRun.activity_run_id,
      type: 'log',
      name: 'path_policy',
      payload: { agent: agent.name, refusals },
    })
  }
  const stopped = refusals.filter((one) => one.verb === 'stop')
  if (stopped.length > 0) {
    throw new Error(stopMessage(agent.name, stopped))
  }

  /*
   * An overstep is reported, not punished and never undone.
   *
   * It used to abort the activity run, which was only worth doing because the
   * abort came with a rollback — and the rollback is what had to go: it
   * assumed every change in the window was the agent's, which is false
   * whenever a developer is working in the same tree. Detection is unchanged
   * and the record is unchanged; the response is a sentence a person reads.
   */
  const overstep: TTreeWarning | undefined =
    observed.overstepped.length === 0 && observed.committed.length === 0
      ? undefined
      : {
          kind: 'overstep',
          activities: [activityRun.params.name],
          activityRunIds: [activityRun.activity_run_id],
          stage: activityRun.params.name,
          paths: observed.overstepped,
          note: [
            `${agent.name} is ${observed.scope}`,
            ...observed.committed,
          ].join(' · '),
        }
  if (overstep !== undefined) {
    run.console.note(
      `${activityRun.params.name}: ${overstep.paths.length} path(s) outside ` +
        `what ${agent.name} declared it writes — reported, not reverted`,
    )
    run.tracer.event({
      run_id: run.runId,
      activity_run_id: activityRun.activity_run_id,
      type: 'log',
      name: WARNING_EVENT,
      payload: warningPayload(overstep),
    })
    run.tracer.event({
      run_id: run.runId,
      activity_run_id: activityRun.activity_run_id,
      type: 'error',
      name: 'permission_breach',
      payload: {
        agent: agent.name,
        paths: overstep.paths,
        note: overstep.note,
        writes: agent.writes ?? null,
        protected_files: run.cfg.defaults.protected_files,
      },
    })
  }

  run.console.envelopeSummary(spec.name, envelope)
  const context = latest
  run.tracer.agentSessionRow(
    run.runId,
    agent,
    sessionId,
    context?.contextTokens ?? 0,
    context?.contextWindow ?? 0,
  )
  run.saveAgentMap(agent.name, {
    session_id: sessionId,
    model: agent.model,
    coding_agent: agent.coding_agent,
  })
  run.tracer.event({
    run_id: run.runId,
    activity_run_id: activityRun.activity_run_id,
    type: 'handoff',
    name: agent.name,
    payload: { artifacts: envelope.artifacts, summary: envelope.summary },
  })
  run.tracer.event({
    run_id: run.runId,
    activity_run_id: activityRun.activity_run_id,
    type: 'agent_end',
    name: agent.name,
    // ActivityRun totals, not the last send's: a retried activityRun paid for every attempt.
    tokens: spent.total_tokens,
    payload: {
      cost: spent.total_cost,
      usage: spent,
      context_tokens: context?.contextTokens ?? 0,
      context_window: context?.contextWindow ?? 0,
    },
  })
  run.console.agentFinished(agent.name, spent.total_tokens, spent.total_cost)
  if (envelope.status !== 'success') {
    throw new Error(
      `${agent.name} reported status='${envelope.status}': ${envelope.summary}`,
    )
  }
  return envelope as TEnvelope
}
