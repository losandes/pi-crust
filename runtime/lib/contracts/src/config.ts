/**
 * The agent roster: `crust.config.yaml` parsed into concrete types.
 *
 * Config says who an agent IS. How it is USED — the output type, the per-call
 * user prompt — lives at the workflow call site, never here.
 */

import { z } from 'zod'
import {
  activityConfigSchema,
  CODING_AGENTS,
  DEFAULT_MODEL,
  plannerConfigSchema,
  promptsSchema,
  terminalConfigSchema,
} from './activity'

export type { TCodingAgent, TPrompts } from './activity'
export {
  CODING_AGENTS,
  DEFAULT_MODEL,
  promptsSchema,
} from './activity'

export const DEFAULT_DATA_DIR = '.pi-crust/data'
export const DEFAULT_DB = '.pi-crust/data/crust.db'
export const DEFAULT_CONFIG_PATH = '.pi-crust/config/crust.config.yaml'
export const DEFAULT_BE_PORT = 4600
export const DEFAULT_FE_PORT = 4601

export const agentConfigSchema = z.object({
  name: z.string(),
  coding_agent: z.enum(CODING_AGENTS).default('pi'),
  model: z.string().default(DEFAULT_MODEL),
  /** off | minimal | low | medium | high | xhigh | max */
  thinking: z.string().default('medium'),
  /** hex swatch for this agent's lane in the UI */
  color: z.string().default(''),
  purpose: z.string().default(''),
  prompts: promptsSchema,
  /**
   * Kept out of interactive menus. Described in full on the Activity schema
   * in `activity.ts`, which is the canonical definition; this mirrors it so
   * a loaded config carries the flag through to the menu.
   *
   * The two schemas are converging — an agent IS an Activity — and should
   * become one once nothing reads `agents` by that name.
   */
  hidden: z.boolean().default(false),
  /** allowlist; undefined = all tools usable */
  tools: z.array(z.string()).optional(),
  // What this agent may MODIFY in the repo, enforced in code after every call
  // (see domains/policy/src/use-cases/enforce-permissions.ts). `tools` cannot
  // express this: `bash` runs anything and `write` reaches any path, so an
  // agent's capability list is a statement of intent that nothing checks.
  // What this agent may change, and where its own documents go.
  //
  //   ['*']            -> anywhere, except the roster-wide `protected_files`
  //   []               -> nothing: it modifies no file at all
  //   ['{handoff}/x.md'] -> only that document, inside this run's handoff dir
  //   [...]            -> only these. A trailing "/" means a directory prefix;
  //                       a "*" makes it a glob; anything else is exact.
  //
  // Required, with no default. Omitting it used to mean "anywhere", so
  // silence granted the most dangerous permission and an agent nobody had
  // thought about was the least restricted one on the roster.
  //
  // `{handoff}` expands to this run's context_handoff directory, which has a
  // different path every run and so cannot be written literally. Naming the
  // document here rather than only in the prompt is what lets two agents run
  // concurrently: a stage can only claim concurrency when its agents' paths
  // do not overlap, and that is a question about this list.
  writes: z.array(z.string()),
})
export type TAgentConfig = Readonly<z.infer<typeof agentConfigSchema>>

/**
 * What happens when a governed path is reached for.
 *
 *   block   refused before the call runs. Nothing is read, nothing is
 *           written. The agent is told, and the refusal is reported.
 *   stop    it happened; the run ends at that Activity, loudly.
 *   warn    it happened; reported with every other warning; the run continues.
 *   allow   not governed at all.
 *
 * There is deliberately no `revert`. Undoing a write assumes pi-crust knows
 * whose write it was, and a developer working in the same branch is
 * indistinguishable from an agent in a diff. `block` is the verb that
 * protects rather than reports, which is why it is the shipped default: the
 * other three describe an exposure that has already happened, and for a
 * credentials file that is no protection at all — the bytes are in a model's
 * context, in its session on disk, and possibly in a provider's logs.
 */
export const PATH_POLICY_VERBS = ['block', 'stop', 'warn', 'allow'] as const
export type TPathPolicyVerb = (typeof PATH_POLICY_VERBS)[number]

const policyVerb = (fallback: TPathPolicyVerb) =>
  z
    .enum(PATH_POLICY_VERBS, {
      error: (issue) =>
        `${String(issue.input)} is not a path policy. Use one of: ` +
        `${PATH_POLICY_VERBS.join(', ')}.`,
    })
    .default(fallback)

/** Read and write are separate questions: for a credentials file, reading is
 * the dangerous half, and for a generated file writing is. */
const pathPolicySchema = (read: TPathPolicyVerb, write: TPathPolicyVerb) =>
  z.object({ read: policyVerb(read), write: policyVerb(write) })

export type TPathPolicy = Readonly<z.infer<ReturnType<typeof pathPolicySchema>>>

export const configDefaultsSchema = z.object({
  coding_agent: z.enum(CODING_AGENTS).default('pi'),
  model: z.string().default(DEFAULT_MODEL),
  thinking: z.string().default('medium'),
  color: z.string().default(''),
  /** roster-wide allowlist; undefined = all tools usable */
  tools: z.array(z.string()).optional(),
  // Off-limits to every agent that has not named them in its own `writes`.
  //
  // `config/` alone, because that is all of the factory a repository still
  // holds: the runtime ships with the package, outside the tree an agent can
  // reach by a relative path at all. The earlier default also listed
  // `modules/`, `stages/`, `lifecycles/` and `package.json`, which the
  // installer now deletes on sight — a default defending paths that cannot
  // exist reads as protection and provides none.
  protected_files: z.array(z.string()).default(['.pi-crust/config/']),
  /**
   * What a tool call reaching one of `protected_files` gets.
   *
   * Blocked both ways by default, because this is the only mechanism that
   * protects rather than reports. The after-the-fact check cannot see these
   * paths at all in the case they are most wanted for: `snapshotTree` is a
   * diff plus untracked files, so a gitignored `.env` never appears in it,
   * and a write to it was invisible — no breach, no report, nothing.
   */
  protected: pathPolicySchema('block', 'block').prefault({}),
  /**
   * What a tool call reaching a GITIGNORED path gets, `data_dir` excepted.
   *
   * Warned on read and blocked on write, which is a different answer from
   * `protected` because it is a different question. Reading a generated file
   * is ordinary work — a build output, a lockfile, a local fixture — and
   * blocking it would break real work for no gain. Writing one produces work
   * that is not in the repository, so no diff, no review and no commit will
   * ever show it.
   *
   * Membership is decided by git rather than by re-implementing `.gitignore`.
   */
  ignored: pathPolicySchema('warn', 'block').prefault({}),
  data_dir: z.string().default(DEFAULT_DATA_DIR),
})
export type TConfigDefaults = Readonly<z.infer<typeof configDefaultsSchema>>

/**
 * The two servers `observe` boots, and the ports a run assumes when it prints
 * a link to itself.
 *
 * They were environment variables only, which made moving a port a thing
 * every developer rediscovered and nobody could commit. CRUST_BE_PORT and
 * CRUST_FE_PORT still win over these, because a one-off clash is exactly
 * what a variable is for.
 */
export const observabilityPortsSchema = z.object({
  backend: z.number().int().default(DEFAULT_BE_PORT),
  frontend: z.number().int().default(DEFAULT_FE_PORT),
})
export type TObservabilityPorts = Readonly<
  z.infer<typeof observabilityPortsSchema>
>

/**
 * Everything about watching a run, read from `crust.observe.yaml` beside the
 * config rather than from a block inside it — see `load-config`. It stays a
 * key on the loaded config so that every caller still reads
 * `cfg.observability.db`.
 */
export const observabilityConfigSchema = z.object({
  db: z.string().default(DEFAULT_DB),
  poll_ms: z.number().int().default(500),
  ports: observabilityPortsSchema.prefault({}),
})
export type TObservabilityConfig = Readonly<
  z.infer<typeof observabilityConfigSchema>
>

// ── routing: what the `checks` gate RUNS ──────────────────────────────────
// Commands are selected by the paths a change actually touched. A stamped
// repository declares its own checkers rather than naming them in a module.
//
// `when` globs use the same matcher as `writes` (use-cases/enforce-permissions):
// `*` does NOT cross `/`, `**` does. `**/*.ts` is therefore required to reach a
// nested file; `*.ts` matches only the repository root. An empty `when` always
// matches.

export const routingCheckSchema = z.object({
  name: z.string(),
  when: z.array(z.string()).default([]),
  /** argv LIST, never a shell string. Binaries by bare name. */
  argv: z.array(z.string()).min(1),
  // Where to run it, relative to the git root. Empty means the git root
  // itself. A repository whose toolchain lives in a subdirectory — a nested
  // workspace, a package with its own config — needs this, and the changed
  // paths handed to the command are rebased onto it so they still resolve.
  cwd: z.string().default(''),
  /** append the matched changed paths — for checkers that take file arguments */
  with_changed_paths: z.boolean().default(false),
  timeout_seconds: z.number().int().default(300),
})
export type TRoutingCheck = Readonly<z.infer<typeof routingCheckSchema>>

/**
 * What an unmatched changed path means, once `routing.checks` is declared.
 *
 *   warn   the default (1.1.1): a gap is reported, named, never failed.
 *   block  opted in (1.3.1), beside the rules it governs: restores the
 *          pre-fix behaviour of failing the gate on an uncovered change.
 */
export const ROUTING_UNMATCHED_POLICIES = ['warn', 'block'] as const
export type TRoutingUnmatchedPolicy =
  (typeof ROUTING_UNMATCHED_POLICIES)[number]

export const routingConfigSchema = z.object({
  checks: z.array(routingCheckSchema).default([]),
  unmatched: z.enum(ROUTING_UNMATCHED_POLICIES).default('warn'),
})
export type TRoutingConfig = Readonly<z.infer<typeof routingConfigSchema>>

export const crustConfigSchema = z.object({
  defaults: configDefaultsSchema.prefault({}),
  observability: observabilityConfigSchema.prefault({}),
  routing: routingConfigSchema.prefault({}),
  /**
   * The roster: every Activity and every Planner, as agents.
   *
   * Assembled from the two lists below rather than written by hand. An
   * Activity IS an agent — there is no second kind of registry entry — and
   * everything that resolves an owner, enforces a writes boundary or renders
   * a prompt reads this one list without caring which half an entry came
   * from.
   */
  agents: z.array(agentConfigSchema).default([]),
  /** what a Lifecycle may name, with the work half each entry declares */
  activities: z.array(activityConfigSchema).default([]),
  /** the closed set of Planners, tuned by configuration and never extended */
  planners: z.array(plannerConfigSchema).default([]),
  /** the closed set of terminal Activities, tuned by configuration and never extended */
  terminal: z.array(terminalConfigSchema).default([]),
})
export type TPiCrustConfig = Readonly<z.infer<typeof crustConfigSchema>>
