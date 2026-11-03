/**
 * Which tool calls are refused, decided BEFORE the call runs.
 *
 * Everything else in this system checks after the fact, against the
 * repository, because that is the only place a claim can be verified. This is
 * the exception, and it is an exception for one reason: a secret that has
 * been read cannot be unread. By the time a diff could report it, the bytes
 * are in a model's context, in its session on disk, and possibly in a
 * provider's logs.
 *
 * It is also the only enforcement pi-crust can perform soundly, because it is
 * the only question where it knows WHOSE action it is: a tool call belongs to
 * the agent that issued it, where a change in the working tree might belong
 * to anybody.
 *
 * Two lists, governed separately:
 *
 *   protected_files   a list a team wrote, naming paths no agent may touch
 *                     unless it named them in its own `writes`
 *   gitignored        whatever `.gitignore` happens to say today, minus this
 *                     run's own session runtime under `data_dir`
 *
 * The session runtime is exempt for the same reason `writes` exempts it: the
 * run's record of itself is gitignored by design, and handoff documents,
 * envelopes, prompts and raw output legitimately land there.
 *
 * LIMIT, stated here because it is the limit of the mechanism: `bash` is
 * best-effort. `read`, `write` and `edit` carry a structured path and are
 * matched exactly; a shell command is a string, and `cat .env`,
 * `grep -r KEY .` and `env > dump` are not reliably distinguishable from
 * legitimate work. A team that must not leak a path should not give that
 * Activity `bash`. Describing a partial defence as protection is worse than
 * having none.
 */

import { isAbsolute, relative, resolve } from 'node:path'
import type { TPathPolicy, TPathPolicyVerb } from '../typedefs/config'
import { matchesPattern } from './enforce-permissions'

/** Reading is the dangerous half for a secret; writing is for a build output. */
export type TPathIntent = 'read' | 'write'

/** Why a path is governed, which decides which policy answers for it. */
export type TPathReason = 'protected' | 'ignored' | 'ungoverned'

/** Everything the decision needs, as one value an extension can be handed. */
export type TPathSettings = Readonly<{
  repoRoot: string
  /** repo-relative, e.g. `.pi-crust/data` — this run's own runtime */
  dataDir: string
  /** this run's handoff directory, repo-relative when inside the repo, else absolute */
  handoffDir: string
  protectedFiles: readonly string[]
  protectedPolicy: TPathPolicy
  ignoredPolicy: TPathPolicy
}>

export type TPathDecision = Readonly<{
  path: string
  intent: TPathIntent
  reason: TPathReason
  verb: TPathPolicyVerb
}>

/**
 * A path as the policy spells it: relative to the repository root.
 *
 * `protected_files` and `.gitignore` are both written from the root, and a
 * tool call may carry either form. A path outside the repository keeps its
 * absolute spelling, which no root-relative pattern can match — correct,
 * because a pattern written for this repository cannot have meant a file
 * somewhere else.
 */
export const repoRelative = (repoRoot: string, path: string): string => {
  const absolute = isAbsolute(path) ? path : resolve(repoRoot, path)
  const within = relative(resolve(repoRoot), absolute)

  return within === '' || within.startsWith('..') ? absolute : within
}

/** This run's own session runtime, which every agent must be able to use. */
export const underDataDir = (settings: TPathSettings, path: string): boolean =>
  path === settings.dataDir ||
  path.startsWith(`${settings.dataDir.replace(/\/+$/, '')}/`)

/**
 * This run's own handoff directory, which may sit outside `data_dir` when
 * `--handoff` relocated it. Exempted for the same reason `data_dir` is: an
 * agent must always be able to write its own handoff document, and a path
 * outside `data_dir` that is also gitignored would otherwise be refused by
 * `ignored.write`.
 */
export const underHandoffDir = (
  settings: TPathSettings,
  path: string,
): boolean =>
  settings.handoffDir !== '' &&
  (path === settings.handoffDir ||
    path.startsWith(`${settings.handoffDir.replace(/\/+$/, '')}/`))

/**
 * What happens to this call.
 *
 * `isIgnored` is passed in rather than computed here, because membership is
 * git's answer and not this module's: re-implementing `.gitignore` matching
 * would be a second opinion that is wrong in ways nobody would find until it
 * mattered.
 */
export const decidePath = (
  params: Readonly<{
    path: string
    intent: TPathIntent
    settings: TPathSettings
    isIgnored: (path: string) => boolean
  }>,
): TPathDecision => {
  const path = repoRelative(params.settings.repoRoot, params.path)
  const ungoverned: TPathDecision = {
    path,
    intent: params.intent,
    reason: 'ungoverned',
    verb: 'allow',
  }
  if (
    underDataDir(params.settings, path) ||
    underHandoffDir(params.settings, path)
  ) {
    return ungoverned
  }
  if (
    params.settings.protectedFiles.some((pattern) =>
      matchesPattern(path, pattern),
    )
  ) {
    return {
      path,
      intent: params.intent,
      reason: 'protected',
      verb: params.settings.protectedPolicy[params.intent],
    }
  }

  return params.isIgnored(path)
    ? {
        path,
        intent: params.intent,
        reason: 'ignored',
        verb: params.settings.ignoredPolicy[params.intent],
      }
    : ungoverned
}

/**
 * What a tool call is asking to do, by the tool's name.
 *
 * Unknown tools are not governed. A tool nobody has classified may well touch
 * a file, and guessing `write` for it would refuse calls nobody intended to
 * govern while still missing the ones that matter — a guarantee that is only
 * apparent is the failure mode worth avoiding.
 */
export const TOOL_INTENTS: Readonly<Record<string, TPathIntent>> = {
  read: 'read',
  write: 'write',
  edit: 'write',
  multiedit: 'write',
}

/** The argument names pi's file tools carry a path under. */
const PATH_ARGS = ['path', 'file_path', 'filePath', 'file'] as const

export const pathsFromInput = (
  toolName: string,
  input: Readonly<Record<string, unknown>>,
): readonly string[] => {
  if (TOOL_INTENTS[toolName.toLowerCase()] === undefined) {
    return []
  }

  return PATH_ARGS.flatMap((key) => {
    const value = input[key]

    return typeof value === 'string' && value !== '' ? [value] : []
  })
}

/**
 * Paths a shell command appears to name — best-effort, and no more.
 *
 * Whitespace-delimited tokens, with surrounding quotes and a `>` or `<`
 * stripped. It catches `cat .env` and `cp .env /tmp/x`; it does not catch
 * `cat .e''nv`, `grep -r SECRET .`, `env > dump`, or anything behind a
 * variable. Blocking the obvious spellings raises the apparent guarantee
 * without raising the real one, so this exists to REPORT, and the honest
 * answer for a path that must not leak is to withhold `bash`.
 */
export const bashTokens = (command: string): readonly string[] =>
  command
    .split(/[\s;|&]+/)
    .map((token) => token.replace(/^[<>'"`(]+|['"`)]+$/g, ''))
    .filter((token) => token !== '' && !token.startsWith('-'))

/** What the agent is told, in the turn where it asked. */
export const refusalMessage = (decision: TPathDecision): string =>
  decision.reason === 'protected'
    ? `${decision.path} is a protected path in this repository's ` +
      `crust.config.yaml, and may not be ${decision.intent === 'read' ? 'read' : 'written'}. ` +
      'Report this in your envelope rather than working around it.'
    : `${decision.path} is gitignored, so it is not this repository's to ` +
      `${decision.intent === 'read' ? 'read' : 'change'}. Work on files the ` +
      'repository tracks, and say in your envelope what you needed.'

/** One governed call, as the run records it and the surfaces report it. */
export type TRefusal = Readonly<{
  tool: string
  path: string
  intent: TPathIntent
  reason: TPathReason
  verb: TPathPolicyVerb
  /** best-effort means the match came from a shell string, not an argument */
  bestEffort: boolean
}>

export const refusalLine = (refusal: TRefusal): string =>
  `${refusal.verb} ${refusal.intent} of ${refusal.path} by ${refusal.tool}` +
  `${refusal.bestEffort ? ' (matched in a shell command, best-effort)' : ''}`

/** One tool call, as pi's `tool_call` event presents it. */
export type TToolCall = Readonly<{
  toolName: string
  input: Readonly<Record<string, unknown>>
}>

/**
 * Every path one tool call reaches for, with how it was found.
 *
 * A structured argument is exact. A shell command is a string, so its tokens
 * are matched best-effort and marked as such wherever they are reported. A
 * command is treated as a READ of everything it names: it is the weaker of
 * the two intents to assert and the stronger one to defend, because a command
 * that writes a protected path has almost always read it too.
 */
export const targetsOf = (
  call: TToolCall,
): readonly Readonly<{
  path: string
  intent: TPathIntent
  bestEffort: boolean
}>[] => {
  const tool = call.toolName.toLowerCase()
  const intent = TOOL_INTENTS[tool]
  if (intent !== undefined) {
    return pathsFromInput(call.toolName, call.input).map((path) => ({
      path,
      intent,
      bestEffort: false,
    }))
  }
  const command = call.input.command

  return tool === 'bash' && typeof command === 'string'
    ? bashTokens(command).map((path) => ({
        path,
        intent: 'read' as const,
        bestEffort: true,
      }))
    : []
}

/** What the policy does about one call: what to record, and whether to refuse. */
export type TGoverned = Readonly<{
  refusals: readonly TRefusal[]
  /** present only for `block`, which is the only verb that refuses */
  blocked: TPathDecision | undefined
}>

/**
 * Rule on one tool call. Pure: no git, no disk, no environment.
 *
 * `stop` and `warn` let the call run \u2014 they buy the audit trail without the
 * interference, and the run answers for them afterwards. Only `block`
 * refuses, and only `block` can promise that nothing was read.
 */
export const governToolCall = (
  params: Readonly<{
    call: TToolCall
    settings: TPathSettings
    isIgnored: (path: string) => boolean
  }>,
): TGoverned => {
  const ruled = targetsOf(params.call).map((target) => ({
    target,
    decision: decidePath({
      path: target.path,
      intent: target.intent,
      settings: params.settings,
      isIgnored: params.isIgnored,
    }),
  }))
  const governed = ruled.filter((one) => one.decision.verb !== 'allow')

  return {
    refusals: governed.map((one) => ({
      tool: params.call.toolName,
      path: one.decision.path,
      intent: one.decision.intent,
      reason: one.decision.reason,
      verb: one.decision.verb,
      bestEffort: one.target.bestEffort,
    })),
    blocked: governed.find((one) => one.decision.verb === 'block')?.decision,
  }
}
