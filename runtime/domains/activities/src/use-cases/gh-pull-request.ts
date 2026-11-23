/**
 * `gh-pull-request`: the first terminal Activity.
 *
 * It runs once, after a run's revise loop has settled with an accepted
 * result, outside the fold. Every git and `gh` operation is the harness's —
 * the agent half gets `read` only and composes a title and a body from the
 * draft the harness already wrote. See `run-terminal.ts` for where this is
 * invoked, and `adr`-adjacent requirements in the plan this implements
 * (issue #52) for the full rationale.
 */

import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import type { TSettlement } from '../../../../../lib/typedefs'
import {
  errorMessage,
  fail,
  safeParseSettlement,
  succeed,
} from '../../../../../lib/typedefs'
import type {
  TActivityContext,
  TActivityOptions,
  TActivityRunHandle,
  TActivityRunParams,
  TBaseBranch,
  TPullRequestOutput,
  TRunState,
  TTerminalConfig,
} from '../../../../lib/contracts'
import {
  activityRunParams,
  narrowEnvelope,
  PULL_REQUEST_EVENT,
  pullRequestOutput,
  violationsOf,
} from '../../../../lib/contracts'
import { writeText } from '../../../../lib/system'
import { ARTIFACT_CHECKS } from '../../../gates'
import { readRunState } from '../../../trace'
import {
  baseBranchFrom,
  baseBranchProvenance,
  changedFiles,
  commitsAhead,
  currentBranch,
  isRepo,
  pushBranch,
  remoteDefaultBranch,
  remoteExists,
  untrackedFiles,
  upstreamBase,
} from '../../../workspace'
import type { TAgentPorts } from './execute-agent'
import { callAgent, liveAgent } from './execute-agent'
import type { TBodyFacts } from './pull-request-body'
import {
  activitiesSection,
  checksSection,
  composedBody,
  issueLine,
  issueRefs,
  titleWithIssues,
} from './pull-request-body'
import { readEnvelope } from './read-envelope'

/** What the harness sends to the forge. */
export type TPullRequestParams = Readonly<{
  title: string
  bodyPath: string
  base: string
  branch: string
  draft: boolean
}>

export type TForge = Readonly<{
  authenticated: (cwd: string) => boolean
  /** the login the PR will be authored by; '' when it cannot be read */
  whoami: (cwd: string) => string
  /** '' when the head branch has no open pull request */
  find: (branch: string, cwd: string) => string
  create: (params: TPullRequestParams, cwd: string) => string
  update: (url: string, params: TPullRequestParams, cwd: string) => string
}>

/** Everything outside this process. Injected so every path above is testable. */
export type TDeliveryPorts = Readonly<{
  isRepo: (cwd: string) => boolean
  /** '' when HEAD is detached */
  branch: (cwd: string) => string
  remoteExists: (remote: string, cwd: string) => boolean
  /** the branch <remote>/HEAD names; '' when the remote declares none */
  defaultBranch: (remote: string, cwd: string) => string
  /** '' when neither <remote>/<base> nor <base> resolves */
  baseRef: (remote: string, base: string, cwd: string) => string
  commitsAhead: (baseRef: string, branch: string, cwd: string) => number
  push: (remote: string, branch: string, cwd: string) => void
  /** uncommitted + untracked paths, for the Checks section's working-tree line */
  uncommitted: (cwd: string) => readonly string[]
  forge: TForge
}>

const ghArgv = (
  args: readonly string[],
  cwd: string,
): Readonly<{ status: number; stdout: string; stderr: string }> => {
  const result = spawnSync('gh', [...args], { encoding: 'utf8', cwd })
  if (result.error) {
    return { status: 1, stdout: '', stderr: String(result.error.message) }
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

const ghOrThrow = (args: readonly string[], cwd: string): string => {
  const result = ghArgv(args, cwd)
  if (result.status !== 0) {
    throw new Error(`gh ${args.join(' ')} failed: ${result.stderr.trim()}`)
  }
  return result.stdout.trim()
}

type TPrListEntry = Readonly<{ url: string; number: number }>

const findOpenPr = (branch: string, cwd: string): string => {
  const result = ghArgv(
    [
      'pr',
      'list',
      '--head',
      branch,
      '--state',
      'open',
      '--json',
      'url,number',
      '--limit',
      '1',
    ],
    cwd,
  )
  if (result.status !== 0) {
    return ''
  }
  // biome-ignore lint/plugin/no-intermediate-try-catch: the boundary — a forge response that is not valid JSON means "no open PR was found", not a failed activity run
  try {
    const parsed = JSON.parse(result.stdout) as readonly TPrListEntry[]
    return parsed[0]?.url ?? ''
  } catch (error) {
    void error
    return ''
  }
}

const createArgs = (params: TPullRequestParams): readonly string[] => [
  'pr',
  'create',
  '--title',
  params.title,
  '--body-file',
  params.bodyPath,
  '--base',
  params.base,
  '--head',
  params.branch,
  ...(params.draft ? ['--draft'] : []),
]

const editArgs = (params: TPullRequestParams): readonly string[] => [
  'pr',
  'edit',
  '--title',
  params.title,
  '--body-file',
  params.bodyPath,
]

/** The live wiring: git.ts for the git half, `gh` argv for the forge half. */
export const liveDelivery: TDeliveryPorts = {
  isRepo: (cwd) => isRepo(cwd),
  branch: (cwd) => {
    const name = currentBranch()
    // currentBranch() reads process cwd, not an arbitrary one — callers in
    // this module always run from the run's own vcsRoot, which is also the
    // process cwd for the whole run, so this is accurate in practice. HEAD
    // (detached) is not a branch.
    void cwd
    return name === 'HEAD' ? '' : name
  },
  remoteExists: (remote, cwd) => remoteExists(remote, cwd),
  defaultBranch: (remote, cwd) => remoteDefaultBranch(remote, cwd),
  baseRef: (remote, base, cwd) => upstreamBase(remote, base, cwd),
  commitsAhead: (baseRef, branch, cwd) => commitsAhead(baseRef, branch, cwd),
  push: (remote, branch, cwd) => pushBranch(remote, branch, cwd),
  uncommitted: (cwd) => {
    // changedFiles() and untrackedFiles() read process cwd, not an arbitrary
    // one — same as the `branch` port above, callers here always run from
    // the run's own vcsRoot, which is the process cwd for the whole run.
    void cwd
    return [...changedFiles(), ...untrackedFiles()]
  },
  forge: {
    authenticated: (cwd) => ghArgv(['auth', 'status'], cwd).status === 0,
    whoami: (cwd) => {
      const result = ghArgv(['api', 'user', '--jq', '.login'], cwd)
      return result.status === 0 ? result.stdout.trim() : ''
    },
    find: (branch, cwd) => findOpenPr(branch, cwd),
    create: (params, cwd) => ghOrThrow(createArgs(params), cwd),
    update: (url, params, cwd) => {
      ghOrThrow([...editArgs(params), url], cwd)
      return url
    },
  },
}

/** What the Activity did, for the row, the event and the console. */
export type TDeliveryResult = Readonly<{
  action: 'created' | 'updated' | 'refused'
  url: string
  /** '' unless refused */
  reason: string
  /** True only when the operator's presence can clear the refusal. */
  recoverable: boolean
  fallback: boolean
}>

export type TTerminalActivity = Readonly<{
  name: string
  params: TActivityRunParams
  requires: readonly string[]
  /** A run that may not commit has nothing for this Activity to deliver. */
  requiresCommitting: boolean
  deliver: (
    ctx: TActivityContext,
    handle: TActivityRunHandle,
  ) => Promise<TDeliveryResult>
}>

/**
 * The attribution block, prepended and appended to every body the harness
 * delivers — this publishes content through the operator's GitHub
 * credentials, and the working agreement requires the author to be named.
 */
export const attributedBody = (
  body: string,
  model: string,
  login: string,
): string => {
  const who = login || 'the run'

  return (
    `> Written by pi-crust (an AI coding agent running ${model}) on behalf ` +
    `of @${who}.\n\n${body}\n\n— pi-crust, on behalf of @${who}.`
  )
}

/** The body when the agent did not supply one. Pure: a trace in, markdown out. */
export const fallbackPullRequest = (
  params: Readonly<{
    runId: string
    prompt: string
    because: string
    state: TRunState | undefined
    declaredChecks: readonly string[]
    uncommitted: readonly string[]
    composedBy: string
  }>,
): Readonly<{ title: string; body: string }> => {
  const facts: TBodyFacts = {
    runId: params.runId,
    prompt: params.prompt,
    state: params.state,
    declaredChecks: params.declaredChecks,
    uncommitted: params.uncommitted,
    composedBy: params.composedBy,
  }
  const title =
    (params.prompt || `pi-crust run ${params.runId}`)
      .split('\n')[0]
      ?.slice(0, 72) || `pi-crust run ${params.runId}`
  const prose = [
    `> Generated from the trace because ${params.because}.`,
    '',
    '## Request',
    '',
    params.prompt || '(no prompt recorded)',
  ].join('\n')
  const harness = [activitiesSection(facts), checksSection(facts)]
    .filter((section) => section !== '')
    .join('\n\n')
  const withHarness = harness === '' ? prose : `${prose}\n\n${harness}`
  const body = [issueLine(issueRefs(facts)), withHarness]
    .filter((part) => part !== '')
    .join('\n\n')

  return { title, body }
}

const draftPath = (contextHandoffDir: string): string =>
  join(contextHandoffDir, 'pull_request.md')

/** The trailing number of a pull request URL, or 0 when it cannot be read. */
const numberFromUrl = (url: string): number => {
  const match = /\/(\d+)$/.exec(url)
  return match?.[1] === undefined ? 0 : Number(match[1])
}

/** One precondition in the order 1.5.2 checks them. '' means it holds. */
type TPrecondition = Readonly<{
  ok: boolean
  reason: string
  recoverable: boolean
}>

const preconditions = (
  ports: TDeliveryPorts,
  config: TTerminalConfig,
  options: TActivityOptions,
  base: TBaseBranch,
  cwd: string,
): readonly TPrecondition[] => {
  const branch = ports.branch(cwd)

  return [
    {
      ok: options.committing,
      recoverable: false,
      reason:
        '--commit false was in force; a terminal Activity delivers nothing it cannot commit alongside',
    },
    {
      ok: ports.isRepo(cwd) && branch !== '',
      recoverable: false,
      reason: 'the workspace is not a git repository, or HEAD is detached',
    },
    {
      ok: branch !== base.name,
      recoverable: false,
      reason:
        `the current branch IS the base branch '${base.name}' ` +
        `(${baseBranchProvenance(base)}) — pi-crust does not create branches`,
    },
    {
      ok: ports.remoteExists(config.delivery.remote, cwd),
      recoverable: false,
      reason: `delivery.remote ('${config.delivery.remote}') is not a configured remote`,
    },
    {
      recoverable: false,
      ok: ports.baseRef(config.delivery.remote, base.name, cwd) !== '',
      reason:
        `base branch '${base.name}' (${baseBranchProvenance(base)}) does not exist: ` +
        `neither refs/remotes/${config.delivery.remote}/${base.name} ` +
        `nor ${base.name} resolves to a commit`,
    },
    {
      recoverable: false,
      ok:
        ports.commitsAhead(
          ports.baseRef(config.delivery.remote, base.name, cwd),
          branch,
          cwd,
        ) > 0,
      reason: `the branch is not ahead of ${base.name}`,
    },
    {
      ok: ports.forge.authenticated(cwd),
      recoverable: true,
      reason: "'gh' is not installed, or 'gh auth status' failed",
    },
  ]
}

const firstRefusal = (
  ports: TDeliveryPorts,
  config: TTerminalConfig,
  options: TActivityOptions,
  base: TBaseBranch,
  cwd: string,
): TPrecondition | undefined =>
  preconditions(ports, config, options, base, cwd).find((one) => !one.ok)

export const ghPullRequestActivity = (
  config: TTerminalConfig,
  options: TActivityOptions,
  ports: TDeliveryPorts = liveDelivery,
  agentPorts: TAgentPorts = liveAgent,
): TTerminalActivity => ({
  name: config.name,
  params: activityRunParams({
    name: config.name,
    kind: 'agent',
    owner: config.name,
    description: config.purpose,
  }),
  requires: [config.name],
  requiresCommitting: true,

  deliver: async (ctx, handle) => {
    const run = ctx.run
    const cwd = run.vcsRoot
    const base = baseBranchFrom({
      flag: '',
      configured: config.delivery.base,
      remoteDefault: ports.defaultBranch(config.delivery.remote, cwd),
      remote: config.delivery.remote,
    })

    const refuse = (reason: string, recoverable: boolean): TDeliveryResult => {
      run.console.note(`${config.name}: refused — ${reason}`)
      run.tracer.event({
        run_id: run.runId,
        activity_run_id: handle.activityRun.activity_run_id,
        type: 'log',
        name: 'pull_request_refused',
        payload: {
          reason,
          branch: ports.branch(cwd),
          base: base.name,
          remote: config.delivery.remote,
        },
      })
      return {
        action: 'refused',
        url: '',
        reason,
        recoverable,
        fallback: false,
      }
    }
    const refusal = firstRefusal(ports, config, options, base, cwd)
    if (refusal !== undefined) {
      return refuse(refusal.reason, refusal.recoverable)
    }

    const branch = ports.branch(cwd)
    const state = readRunState(run.tracer.dbPath, run.runId)
    const facts: TBodyFacts = {
      runId: run.runId,
      prompt: ctx.prompt,
      state,
      declaredChecks: Object.keys(run.cfg.tasks).map((name) => `task ${name}`),
      uncommitted: ports.uncommitted(cwd),
      composedBy: config.name,
    }
    const draft = fallbackPullRequest({
      runId: run.runId,
      prompt: ctx.prompt,
      because: 'the agent has not answered yet',
      state,
      declaredChecks: facts.declaredChecks,
      uncommitted: facts.uncommitted,
      composedBy: facts.composedBy,
    })
    writeText(draftPath(run.contextHandoffDir), draft.body)

    /*
     * A failed agent call must not fail the activity run — 1.6.5 requires
     * the harness to fall back instead — so the throw is caught here and
     * turned into the settlement the rest of this function already
     * reasons in.
     */
    const ask = async (
      feedback: readonly string[],
    ): Promise<TSettlement<TPullRequestOutput>> => {
      // biome-ignore lint/plugin/no-intermediate-try-catch: the boundary — a failed agent call must become a fallback, not a thrown activity-run failure (1.6.5)
      try {
        return succeed(
          await callAgent(
            run,
            handle,
            {
              outputType: pullRequestOutput,
              prompt: ctx.prompt,
              ...(ctx.previous === undefined ? {} : { previous: ctx.previous }),
              upstream: ctx.upstream,
              cohort: ctx.cohort,
              feedback,
              blockingFindings: [],
              committing: false,
            },
            agentPorts,
          ),
        )
      } catch (error) {
        return fail(error instanceof Error ? error : new Error(String(error)))
      }
    }
    const judge = (composed: TSettlement<TPullRequestOutput>) => {
      const answered =
        composed.status === 'ok'
          ? narrowEnvelope(pullRequestOutput, composed.data)
          : undefined
      const violations =
        answered === undefined
          ? []
          : ARTIFACT_CHECKS.flatMap((gate) => {
              const report = gate.check(answered, run, [])
              const faults = violationsOf(report)
              run.tracer.gateRow(handle.activityRun, gate.name, report)
              run.tracer.event({
                run_id: run.runId,
                activity_run_id: handle.activityRun.activity_run_id,
                type: faults.length > 0 ? 'gate_fail' : 'gate_pass',
                name: gate.name,
                payload: { violations: faults, checks: report.checks },
              })
              run.console.gateResult(gate.name, report)
              return faults
            })
      return { composed, answered, violations }
    }
    const first = judge(
      run.resume.has(config.name)
        ? readEnvelope(run, config.name, pullRequestOutput)
        : await ask(ctx.feedback),
    )
    const final =
      first.violations.length === 0
        ? first
        : judge(await ask([...ctx.feedback, ...first.violations]))
    const { composed, answered, violations } = final
    const usable =
      violations.length === 0 &&
      answered !== undefined &&
      answered.status === 'success' &&
      answered.title.trim() !== '' &&
      answered.body.trim() !== ''

    const fallbackBecause =
      composed.status === 'error'
        ? `the agent call failed: ${composed.error.message}`
        : violations.length > 0
          ? `the agent's report failed its output checks: ${violations.join('; ')}`
          : answered === undefined || answered.status !== 'success'
            ? 'the agent reported status: fail, or its envelope could not be read'
            : 'the agent answered with an empty title or body'

    const deliveredFacts: TBodyFacts = {
      ...facts,
      state: readRunState(run.tracer.dbPath, run.runId),
    }
    const chosen = usable
      ? {
          title: answered.title.trim(),
          body: composedBody(answered.body.trim(), deliveredFacts),
        }
      : fallbackPullRequest({
          ...deliveredFacts,
          because: fallbackBecause,
        })
    const fellBack = !usable
    if (fellBack) {
      run.console.note(
        `${config.name}: falling back to a trace-generated PR body — ${fallbackBecause}`,
      )
    }

    const login = ports.forge.whoami(cwd) || run.engineer
    const finalBody = attributedBody(chosen.body, config.model, login)
    const bodyPath = draftPath(run.contextHandoffDir)
    writeText(bodyPath, finalBody)

    const pushed = safeParseSettlement(() => {
      // biome-ignore lint/plugin/no-array-mutation: ports.push is this module's own git-push port, not Array.prototype.push
      ports.push(config.delivery.remote, branch, cwd)
    })
    if (pushed.status === 'error') {
      return refuse(
        `git push failed: ${errorMessage(pushed.error).split('\n')[0] ?? ''}`,
        true,
      )
    }

    const params: TPullRequestParams = {
      title: titleWithIssues(chosen.title, issueRefs(facts)),
      bodyPath,
      base: base.name,
      branch,
      draft: config.delivery.draft,
    }

    const existing = ports.forge.find(branch, cwd)
    const action = existing === '' ? 'created' : 'updated'
    const url =
      existing === ''
        ? ports.forge.create(params, cwd)
        : ports.forge.update(existing, params, cwd)

    run.console.note(`${config.name}: ${action} ${url}`)
    run.tracer.event({
      run_id: run.runId,
      activity_run_id: handle.activityRun.activity_run_id,
      type: 'log',
      name: PULL_REQUEST_EVENT,
      payload: {
        action,
        url,
        number: numberFromUrl(url),
        branch,
        base: base.name,
        draft: config.delivery.draft,
        fallback: fellBack,
      },
    })

    return { action, url, reason: '', recoverable: false, fallback: fellBack }
  },
})
