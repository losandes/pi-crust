/**
 * Asking a finished step a question, and letting it amend its own document.
 *
 * A step's conversation is not thrown away when the step ends: pi keeps it as
 * a session, and a later process can rejoin it by id. So "what did you mean
 * by this" costs one turn against an agent that still remembers everything,
 * instead of a re-run that derives the whole thing again from nothing.
 *
 * Two modes, one path, because they differ in exactly two ways and splitting
 * them would be two implementations of the same idea drifting apart:
 *
 *   ask    — read-only tools. Nothing can change.
 *   amend  — the write tools, and the lock lifted from the documents THIS
 *            step created. Everything another step wrote stays read-only,
 *            and anything that changes anyway is restored.
 *
 * Neither opens an activity run. A consult is something that happened TO a step, not
 * a step of its own: giving it an activity run row would put it in the waterfall,
 * change the run's shape, and make a question look like work the lifecycle
 * asked for.
 */

import { join, resolve } from 'node:path'
import {
  isStepDocument,
  lockArtifacts,
  unlockArtifacts,
} from '../data/artifact-lock'
import { nowIso } from '../data/clock'
import { fileExists } from '../data/files'
import {
  changed,
  diffHandoff,
  readAll,
  restoreAll,
  snapshotHandoff,
} from '../data/handoff-snapshot'

/** What a consult may do to the step's own documents. */
export type TConsultMode = 'ask' | 'amend'

/**
 * Tools per mode.
 *
 * `ask` is read-only by CAPABILITY, not by instruction: an agent with no
 * writing tool cannot write, which is a stronger claim than a prompt asking
 * it not to. `bash` is absent from both — it is a writing tool wearing a
 * different hat, and the whole guarantee here rests on that not being true.
 */
export const TOOLS: Readonly<Record<TConsultMode, readonly string[]>> = {
  ask: ['read', 'grep', 'find', 'ls'],
  amend: ['read', 'grep', 'find', 'ls', 'edit', 'write'],
}

export type TConsultRequest = Readonly<{
  runId: string
  /** The activityRun being consulted — the thread hangs off it. */
  activityRunId: string
  agent: string
  /** The pi session that activity-run's agent left behind. */
  sessionId: string
  sessionDir: string
  handoffDir: string
  mode: TConsultMode
  question: string
  /** Documents this activityRun created, which an amend may replace. */
  own: readonly string[]
}>

export type TConsultOutcome = Readonly<{
  answered: boolean
  answer: string
  /** Documents of THIS step that the consult rewrote. */
  amended: readonly string[]
  /** Documents of OTHER steps it touched, and we put back. */
  restored: readonly string[]
  reason: string
}>

/** A session that is not on disk cannot be rejoined, and must say so. */
export const sessionMissing = (dir: string): boolean => !fileExists(dir)

/**
 * The argv for one consult turn.
 *
 * Print mode, not RPC: there is nothing to steer mid-turn, and a consult is
 * one question with one answer. `--session-id` rejoins the existing session,
 * which is the whole point — verified against a real finished run before any
 * of this was written.
 */
export const consultArgv = (
  request: TConsultRequest,
  model: Readonly<{ provider: string; modelId: string }>,
  piBinary: string,
): readonly string[] => [
  piBinary,
  '--print',
  '--provider',
  model.provider,
  '--model',
  model.modelId,
  '--session-id',
  request.sessionId,
  '--session-dir',
  request.sessionDir,
  '--tools',
  TOOLS[request.mode].join(','),
  /*
   * The preamble is composed HERE and nowhere else.
   *
   * Baking it into `question` would store it as part of what the person
   * asked, and the interface would then have to strip it back off by
   * guessing where it ended — which eats the first paragraph of any
   * ordinary multi-paragraph question. The record keeps what was typed.
   */
  `${preamble(request.mode)}\n\n${request.question}`,
]

/**
 * What the agent is told about the consult, ahead of the question itself.
 *
 * It needs to know which of the two this is, because the honest answer to
 * "can you change that" differs: in `ask` the answer is no, and an agent that
 * tries will have its tool call refused and report a failure it could have
 * explained instead.
 */
export const preamble = (mode: TConsultMode): string =>
  mode === 'ask'
    ? [
        'A person is asking about work you already finished. Answer from what',
        'you remember and what you can read. You have no writing tools in',
        'this turn: if the answer is that something should change, say what',
        'and why, and leave it to them.',
      ].join(' ')
    : [
        'A person is asking you to amend work you already finished. You may',
        'rewrite the documents YOU wrote and nothing else — every other',
        "step's documents are read-only and a write to one will be refused",
        'and reverted. Make the change asked for and no more; the steps after',
        'you have already run against what you wrote, so a change beyond what',
        'was asked silently invalidates their work.',
      ].join(' ')

/**
 * Run one consult, bracketed by the same ownership rules an activity run gets.
 *
 * The bracket is the guarantee, and it is deliberately the SAME one: unlock
 * what this step owns, observe everything, re-lock, restore what belongs to
 * somebody else. A second implementation of "may I write this" is a second
 * chance to get it wrong.
 */
export const runConsult = async (
  request: TConsultRequest,
  invoke: (argv: readonly string[]) => Promise<
    Readonly<{ ok: boolean; output: string }>
  >,
  argv: readonly string[],
): Promise<TConsultOutcome> => {
  if (sessionMissing(request.sessionDir)) {
    return {
      answered: false,
      answer: '',
      amended: [],
      restored: [],
      // Pruning deletes session directories, so this is a normal end state
      // for an old run rather than a defect. Starting a fresh session here
      // would answer the question with an agent that remembers nothing,
      // which is worse than refusing.
      reason: `no session on disk for ${request.agent} — pruned, or never recorded`,
    }
  }

  const before = snapshotHandoff(request.handoffDir)
  const originals = readAll(request.handoffDir, [...before.keys()])
  const own = new Set(request.own)
  if (request.mode === 'amend') {
    unlockArtifacts(request.handoffDir, [...own])
  }

  const result = await invoke(argv)

  const change = diffHandoff(before, snapshotHandoff(request.handoffDir))
  /*
   * What this consult legitimately produced: a new document, or a rewrite of
   * one this step already owned. Locked again on the way out, so the next
   * step has no more right to it than before.
   */
  const mine =
    request.mode === 'amend'
      ? [
          ...change.created.filter(isStepDocument),
          ...change.modified.filter((path) => own.has(path)),
        ]
      : []
  lockArtifacts(request.handoffDir, mine)

  // Anything belonging to another step is damage whichever mode this was.
  const damaged = [...change.modified, ...change.deleted].filter(
    (path) => isStepDocument(path) && !own.has(path),
  )
  const restored = restoreAll(request.handoffDir, originals, damaged)
  lockArtifacts(request.handoffDir, restored)

  return {
    answered: result.ok,
    answer: result.output.trim(),
    amended: changed(change) ? mine : [],
    restored,
    reason: result.ok ? '' : 'the coding agent exited non-zero',
  }
}

/** Where a run keeps one agent's pi session. */
export const sessionDirFor = (
  dataDir: string,
  runId: string,
  agent: string,
): string => resolve(join(dataDir, 'sessions', runId, agent, 'pi_sessions'))

/** The thread event a consult leaves on the activityRun it asked about. */
export const consultEvent = (
  request: TConsultRequest,
  outcome: TConsultOutcome,
): Readonly<{ name: string; payload: Readonly<Record<string, unknown>> }> => ({
  name: `${request.agent} ${request.mode}`,
  payload: {
    mode: request.mode,
    agent: request.agent,
    question: request.question,
    answer: outcome.answer,
    answered: outcome.answered,
    amended: outcome.amended,
    restored: outcome.restored,
    reason: outcome.reason,
    at: nowIso(),
  },
})
