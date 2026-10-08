/**
 * The agent roster: `crust.config.yaml` parsed into concrete types.
 *
 * Config says who an agent IS. How it is USED — the output type, the per-call
 * user prompt — lives at the workflow call site, never here.
 */

import { z } from 'zod'
import { QUALITY_AREAS, QUALITY_OPERATIONS } from './quality'

export const CODING_AGENTS = ['pi', 'claude_code'] as const
export type TCodingAgent = (typeof CODING_AGENTS)[number]

export const DEFAULT_MODEL = 'google/gemini-3.6-flash'
export const DEFAULT_DATA_DIR = '.pi-crust/data'
export const DEFAULT_DB = '.pi-crust/data/crust.db'
export const DEFAULT_CONFIG_PATH = '.pi-crust/config/crust.config.yaml'

export const promptEngineeringSchema = z.object({
  /** path to system.md */
  system: z.string(),
  /** path to user.md */
  user: z.string(),
})
export type TPromptEngineering = Readonly<
  z.infer<typeof promptEngineeringSchema>
>

export const agentConfigSchema = z.object({
  name: z.string(),
  coding_agent: z.enum(CODING_AGENTS).default('pi'),
  model: z.string().default(DEFAULT_MODEL),
  /** off | minimal | low | medium | high | xhigh | max */
  thinking: z.string().default('medium'),
  /** hex swatch for this agent's lane in the UI */
  color: z.string().default(''),
  purpose: z.string().default(''),
  prompt_engineering: promptEngineeringSchema,
  harness_engineering: z.array(z.string()).default([]),
  /** allowlist; undefined = all tools usable */
  tools: z.array(z.string()).optional(),
  // What this agent may MODIFY in the repo, enforced in code after every call
  // (see modules/use-cases/enforce-permissions.ts). `tools` cannot express
  // this: `bash` runs anything and `write` reaches any path, so an agent's
  // capability list is a statement of intent that nothing checks.
  //   undefined -> unrestricted, except the roster-wide `protected_files`
  //   []        -> read-only: may modify nothing tracked
  //   [...]     -> only these. A trailing "/" means a directory prefix; a "*"
  //                makes it a glob; anything else is an exact path.
  writes: z.array(z.string()).optional(),
})
export type TAgentConfig = Readonly<z.infer<typeof agentConfigSchema>>

export const configDefaultsSchema = z.object({
  coding_agent: z.enum(CODING_AGENTS).default('pi'),
  model: z.string().default(DEFAULT_MODEL),
  thinking: z.string().default('medium'),
  color: z.string().default(''),
  harness_engineering: z.array(z.string()).default([]),
  /** roster-wide allowlist; undefined = all tools usable */
  tools: z.array(z.string()).optional(),
  // Off-limits to every agent that has not named them in its own `writes`.
  // The factory's own code is the default: an agent must not be able to edit
  // the machinery that decides whether its work passed.
  protected_files: z
    .array(z.string())
    .default([
      '.pi-crust/modules/',
      '.pi-crust/config/',
      '.pi-crust/stages/',
      '.pi-crust/lifecycles/',
      '.pi-crust/package.json',
    ]),
  data_dir: z.string().default(DEFAULT_DATA_DIR),
})
export type TConfigDefaults = Readonly<z.infer<typeof configDefaultsSchema>>

export const observabilityConfigSchema = z.object({
  db: z.string().default(DEFAULT_DB),
  poll_ms: z.number().int().default(500),
})
export type TObservabilityConfig = Readonly<
  z.infer<typeof observabilityConfigSchema>
>

// ── routing: what agents LOAD and what `verify` RUNS ────────────────────────
// Both are selected by the paths a change actually touched. crust is stamped
// into other repositories, so neither a skill path nor a checker command may
// appear in a prompt or a module — a repo that has no such skill simply
// declares none here, and the step still runs.
//
// `when` globs use the same matcher as `writes` (use-cases/enforce-permissions):
// `*` does NOT cross `/`, `**` does. `**/*.ts` is therefore required to reach a
// nested file; `*.ts` matches only the repository root. An empty `when` always
// matches.

export const routingSkillSchema = z.object({
  name: z.string(),
  /** path to a skill file or directory, passed to the coding agent verbatim */
  path: z.string(),
  /** agents that receive it; empty = every agent */
  agents: z.array(z.string()).default([]),
  when: z.array(z.string()).default([]),
  /** phase names that receive it; empty = every phase. `revise_2` matches `revise`. */
  phases: z.array(z.string()).default([]),
})
export type TRoutingSkill = Readonly<z.infer<typeof routingSkillSchema>>

export const routingCheckSchema = z.object({
  name: z.string(),
  when: z.array(z.string()).default([]),
  operation: z.enum(QUALITY_OPERATIONS).default('lint'),
  area: z.enum(QUALITY_AREAS).default('backend'),
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

export const routingConfigSchema = z.object({
  skills: z.array(routingSkillSchema).default([]),
  checks: z.array(routingCheckSchema).default([]),
})
export type TRoutingConfig = Readonly<z.infer<typeof routingConfigSchema>>

/**
 * How the step menu behaves. Neither key changes what CAN run.
 *
 * `order` is the sequence a hand-picked chain runs in; `hidden` is what the
 * menu stops offering. A lifecycle, an operator, or an explicit `--steps`
 * still runs anything — hiding a step is a preference about a menu, and
 * disabling one would be a developer quietly running a shorter chain than
 * the repository agreed to.
 */
export const stepsConfigSchema = z.object({
  /**
   * A partial list is normal and safe: the steps named here take the slots
   * that named steps occupy in the built-in order, and everything else stays
   * exactly where it was.
   */
  order: z.array(z.string()).default([]),
  /** Kept out of `please`'s menu. Still runnable by name. */
  hidden: z.array(z.string()).default([]),
})
export type TStepsConfig = Readonly<z.infer<typeof stepsConfigSchema>>

export const crustConfigSchema = z.object({
  defaults: configDefaultsSchema.prefault({}),
  steps: stepsConfigSchema.prefault({}),
  observability: observabilityConfigSchema.prefault({}),
  routing: routingConfigSchema.prefault({}),
  agents: z.array(agentConfigSchema).default([]),
})
export type TPiCrustConfig = Readonly<z.infer<typeof crustConfigSchema>>
