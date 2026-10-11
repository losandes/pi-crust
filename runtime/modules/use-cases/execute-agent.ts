/**
 * One agent call: render prompts -> pi run -> typed parse -> gates -> envelope.
 *
 * Parse failures and gate violations re-prompt the SAME session with a
 * correction — context intact, bounded retries. Agent proposes, code disposes.
 */

import { inboxSince } from '../data/inbox'
import { join, resolve } from 'node:path'
import { ensureDir, writeText } from '../data/files'
import { changedFiles, untrackedFiles } from '../data/git'
import { newId } from '../data/ids'
import * as piAgent from '../data/pi-agent'
import { render, savePrompt } from '../data/prompt-files'
import { snapshotTree } from '../data/working-tree'
import type { TAgentConfig } from '../typedefs/config'
import type { TEnvelopeBase, TEnvelopeSpec } from '../typedefs/envelope'
import type { TAgentCall, TGate } from '../typedefs/gate'
import { violationsOf } from '../typedefs/gate'
import type { TPhase } from '../typedefs/phase'
import type { TPiResult, TUsageBreakdown } from '../typedefs/pi'
import { emptyUsage, mergeUsage } from '../typedefs/pi'
import type { TPhaseHandle, TRun } from '../typedefs/run'
import { errorMessage, safeParseSettlement } from '../typedefs/settlement'
import {
  enforcePermissions,
  handoffDocument,
  PermissionBreach,
} from './enforce-permissions'
import { extractJson } from './extract-json'
import { resolveAgent } from './load-config'
import { trustStance } from '../typedefs/trust'
import { readSteering } from '../data/steering'
import { steeringBlock } from './steer'
import { stepCatalogue } from './step-catalogue'
import { matchingSkills } from './route-by-path'

/** continue-with-correction attempts for malformed JSON */
export const JSON_FIX_ATTEMPTS = 2

export class GateFailure extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GateFailure'
  }
}

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
/** How often a running phase checks whether anybody has said anything. */
export const INBOX_POLL_MS = 1_000

const eventForwarder = (
  run: TRun,
  phase: TPhase,
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
      phase_id: phase.phase_id,
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
      phase_id: phase.phase_id,
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
  phase: TPhase,
  agentName: string,
  spec: TEnvelopeSpec<TEnvelopeBase>,
  envelope: TEnvelopeBase | undefined,
  attempt: number,
  valid: boolean,
  raw = '',
): void => {
  const payloadJson = envelope
    ? JSON.stringify(envelope, null, 2)
    : JSON.stringify({ raw: raw.slice(-2000) })
  run.tracer.envelopeRow(
    phase,
    agentName,
    spec.name,
    payloadJson,
    valid,
    attempt,
  )
  if (envelope) {
    writeText(
      join(run.sessionDir, agentName, 'envelope.json'),
      `${JSON.stringify(
        {
          agent_name: agentName,
          purpose: resolveAgent(run.cfg, agentName).purpose,
          output_type: spec.name,
          attempt,
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
  phase: TPhase,
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
      // phase resuming the session had no previous_envelope to read — the
      // agent's work was on disk and its report was not.
      persistEnvelope(
        run,
        phase,
        phase.params.owner,
        spec,
        settled.data,
        round,
        true,
      )
      return { envelope: settled.data, attempt: round }
    }
    const reason = errorMessage(settled.error)
    persistEnvelope(
      run,
      phase,
      phase.params.owner,
      spec,
      undefined,
      round,
      false,
      result.text,
    )
    if (round > JSON_FIX_ATTEMPTS) {
      throw new Error(
        `${phase.params.owner} never produced valid ${spec.name} JSON: ${reason}`,
      )
    }
    run.console.retry(
      phase.params.owner,
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

const runGates = (
  run: TRun,
  phase: TPhase,
  gates: readonly TGate[],
  envelope: TEnvelopeBase,
  gateAttempt: number,
): readonly string[] =>
  gates.flatMap((gate) => {
    const report = gate.check(envelope, run)
    const found = violationsOf(report)
    run.tracer.gateRow(phase, gate.name, report, gateAttempt)
    run.tracer.event({
      run_id: run.runId,
      phase_id: phase.phase_id,
      type: found.length > 0 ? 'gate_fail' : 'gate_pass',
      name: gate.name,
      payload: {
        attempt: gateAttempt,
        violations: found,
        checks: report.checks,
      },
    })
    run.console.gateResult(gate.name, report)
    return found
  })

/**
 * What a workflow calls inside an agent phase. Valid in that phase only — a
 * code or engineer phase that spawns an agent would render in the wrong lane
 * and hide the spend.
 */
export const callAgent = <TEnvelope extends TEnvelopeBase>(
  run: TRun,
  handle: TPhaseHandle,
  call: TAgentCall<TEnvelope>,
): Promise<TEnvelope> => {
  if (handle.phase.params.kind !== 'agent') {
    throw new Error('callAgent() is only valid inside an agent phase')
  }
  return executeAgent(run, handle.phase, call)
}

export const executeAgent = async <TEnvelope extends TEnvelopeBase>(
  run: TRun,
  phase: TPhase,
  call: TAgentCall<TEnvelope>,
): Promise<TEnvelope> => {
  const agent = resolveAgent(run.cfg, phase.params.owner)
  const agentDir = ensureDir(join(run.sessionDir, agent.name))
  const spec = call.outputType as unknown as TEnvelopeSpec<TEnvelopeBase>
  const gates = call.gates ?? []

  // What this agent is being asked to reason about, as paths. A caller that
  // already knows (a reviewer handed the builder's envelope) says so; otherwise
  // it is whatever the working tree currently has uncommitted.
  const changedPaths =
    call.changedPaths ??
    [...changedFiles(), ...untrackedFiles()].toSorted().filter(Boolean)
  const skills = matchingSkills(
    run.cfg,
    agent.name,
    changedPaths,
    phase.params.name,
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
                `## from ${one.step}\n\n${JSON.stringify(one.envelope, null, 2)}`,
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
        : '(none pre-loaded \u2014 every skill in this repository is still ' +
          'discoverable, and you are expected to reach for the ones that apply)',
    changed_files: changedPaths.length > 0 ? changedPaths.join('\n') : '(none)',
    // What the call is ABOUT, which is not always what is in the working tree:
    // a committed range is absent from it, and the agent has to be told to go
    // and read it rather than conclude nothing was done.
    change_base: call.changeBase ?? '(the uncommitted working tree)',
    /*
     * Only the operator substitutes this, and it is generated from the step
     * registry and the roster rather than written into its prompt. Every
     * other agent renders it to nothing, because `render` leaves an unused
     * variable alone — the cost of computing it for all of them is a string
     * nobody reads, and the alternative is a conditional here that knows
     * which agent is which.
     */
    step_catalogue: stepCatalogue(run.cfg.agents),
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
  const systemText = render(agent.prompt_engineering.system, variables)
  /*
   * Steering is APPENDED, not rendered from a placeholder.
   *
   * A `{{steering}}` variable would be opt-in, and a run sent back with new
   * instructions where one agent's prompt forgot the placeholder is a run
   * that silently ignored the person. Every step from the branch point
   * onward has to hear it, so no prompt gets a say in whether it does.
   */
  const userText = `${render(agent.prompt_engineering.user, variables)}${steeringBlock(
    readSteering(run.contextHandoffDir),
  )}`
  savePrompt(join(agentDir, 'prompts'), 'system.md', systemText)
  savePrompt(join(agentDir, 'prompts'), 'user.md', userText)

  const sessionId = agentSessionId(run, agent)
  run.tracer.event({
    run_id: run.runId,
    phase_id: phase.phase_id,
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
   * One forwarder for the whole phase, not one per send. Turn numbers have to
   * keep climbing across a parse retry or a gate correction — those re-enter
   * the SAME pi session, so restarting the count would make two different
   * passages of thinking claim the same turn and attract each other's calls.
   */
  const forwardEvents = eventForwarder(run, phase, agent.name, run.stream)

  /*
   * Someone outside this process may want to say something to the agent while
   * it works. They cannot reach the child directly, so they append to the
   * run's inbox and this polls it — the only shared surface a web app, a
   * second terminal and this process all have.
   *
   * Polling rather than watching: a watcher is one more thing to leak when a
   * phase ends badly, and a second of latency on a message a human just typed
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
            ? `${entry.from} aborted this phase`
            : `${entry.from} ${entry.kind === 'steer' ? 'steered' : 'queued a follow-up'}: ${entry.message}`,
        )
        run.tracer.event({
          run_id: run.runId,
          phase_id: phase.phase_id,
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
    const result = await piAgent.run(
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
        extensions: agent.harness_engineering,
        skills,
        cwd: run.repoRoot,
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

  // What the tree looked like before this agent got its hands on it. Every send
  // in this phase — first prompt, JSON retries, gate corrections — is measured
  // against this one baseline.
  const treeBefore = snapshotTree(run.repoRoot)

  const first = await parseWithRetries(
    run,
    phase,
    spec,
    await send(userText),
    send,
  )

  // claim gates — violations flow back into the SAME session as corrections
  const settleGates = async (
    parsed: TParsed,
    round: number,
  ): Promise<TParsed> => {
    const violations = runGates(run, phase, gates, parsed.envelope, round)
    if (violations.length === 0) {
      return parsed
    }
    if (round > phase.params.retries) {
      throw new GateFailure(
        `${agent.name} failed gates after ${round} attempt(s):\n- ` +
          violations.join('\n- '),
      )
    }
    run.updatePhase(phase.phase_id, { attempt: round })
    run.console.retry(
      agent.name,
      round,
      phase.params.retries,
      `${violations.length} gate violation(s)`,
    )
    const corrected = await send(
      `Your previous response failed validation:\n- ${violations.join('\n- ')}` +
        '\n\nFix these problems, then re-emit ONLY your Report JSON.',
    )
    return settleGates(
      await parseWithRetries(run, phase, spec, corrected, send),
      round + 1,
    )
  }
  const { envelope } = await settleGates(first, 1)

  // Permission is checked after every send is done, and before the envelope is
  // accepted: an agent does not get to report success on a phase in which it
  // wrote somewhere it was not allowed to.
  const enforced = safeParseSettlement(() =>
    enforcePermissions(
      run,
      agent,
      treeBefore,
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
    ),
  )
  if (enforced.status === 'error') {
    if (enforced.error instanceof PermissionBreach) {
      run.tracer.event({
        run_id: run.runId,
        phase_id: phase.phase_id,
        type: 'error',
        name: 'permission_breach',
        payload: {
          agent: agent.name,
          error: enforced.error.message,
          writes: agent.writes ?? null,
          protected_files: run.cfg.defaults.protected_files,
        },
      })
    }
    throw enforced.error
  }
  if (enforced.data.length > 0) {
    run.tracer.event({
      run_id: run.runId,
      phase_id: phase.phase_id,
      type: 'log',
      name: 'paths_touched',
      payload: { agent: agent.name, paths: enforced.data },
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
    phase_id: phase.phase_id,
    type: 'handoff',
    name: agent.name,
    payload: { artifacts: envelope.artifacts, summary: envelope.summary },
  })
  run.tracer.event({
    run_id: run.runId,
    phase_id: phase.phase_id,
    type: 'agent_end',
    name: agent.name,
    // Phase totals, not the last send's: a retried phase paid for every attempt.
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
