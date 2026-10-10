/**
 * A developer's private overrides of the committed roster.
 *
 * `crust.config.yaml` is the repository's answer and is reviewed. A local
 * layer beside it, gitignored, answers the questions that are one person's:
 * which model their licence reaches, how much thinking that model supports,
 * which harness they run, and what colour they want a lane to be.
 *
 * It is a PATCH over named agents, not a merge of documents. That distinction
 * is the whole design:
 *
 *   * Only four keys may be overridden. A gitignored file that nobody reviews
 *     must not be able to move a safety boundary — `writes`, `tools`,
 *     `protected_files` and the prompts stay with the repository, where a
 *     reviewer sees them. Anything else is an ERROR, not a silent drop: a
 *     developer who writes `writes:` here and sees nothing happen will
 *     believe it applied.
 *
 *   * It cannot add an agent. A locally-added agent is unreachable anyway —
 *     steps bind to owner names in the registry — so it would buy nothing
 *     and smuggle in a prompt and a writes list by the back door.
 *
 *   * An unknown agent name WARNS rather than fails. A name goes stale when
 *     somebody renames an agent in the committed roster, and a colleague's
 *     private file must not break everyone's runs — but a typo that silently
 *     did nothing is exactly the confusion this module exists to avoid, so
 *     it is said out loud.
 */

export const LOCAL_OVERRIDABLE = [
  'model',
  'thinking',
  'color',
  'coding_agent',
] as const

export type TLocalKey = (typeof LOCAL_OVERRIDABLE)[number]

/**
 * Keys of the `steps` block a local layer may set.
 *
 * Safe to hand over precisely because neither changes what CAN run: `order`
 * is the sequence a hand-picked chain takes, `hidden` is what one person's
 * menu stops offering. A lifecycle, an operator or an explicit `--steps`
 * still runs anything, so no colleague's private file can shorten a chain
 * the repository agreed to.
 */
export const LOCAL_STEP_KEYS = ['order', 'hidden'] as const

type TRecord = Record<string, unknown>

const isRecord = (value: unknown): value is TRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** What a local layer did, and what it could not do. */
export type TLocalResult = Readonly<{
  /** the merged document, ready for the schema */
  document: unknown
  /** named agents the roster does not have — said, never fatal */
  warnings: readonly string[]
}>

const ALLOWED = new Set<string>(LOCAL_OVERRIDABLE)

const unsupported = (where: string, entry: TRecord): readonly string[] =>
  Object.keys(entry)
    .filter((key) => key !== 'name' && !ALLOWED.has(key))
    .map((key) => `${where}: '${key}'`)

/** Only the four keys, taken from a local entry. */
const overridesOf = (entry: TRecord): TRecord =>
  Object.fromEntries(Object.entries(entry).filter(([key]) => ALLOWED.has(key)))

const refuse = (offences: readonly string[]): void => {
  if (offences.length === 0) return
  throw new Error(
    `local config may only override ${LOCAL_OVERRIDABLE.join(', ')} ` +
      `on an agent or on defaults, and ${LOCAL_STEP_KEYS.join('/')} under ` +
      'steps — ' +
      `remove ${offences.join(', ')}.\n` +
      'Everything else belongs in the committed config, where it is reviewed.',
  )
}

/**
 * Apply a local layer to a parsed config document.
 *
 * Pure, and it takes documents rather than paths so the rules can be tested
 * without a filesystem — which is the only way the "may not widen writes"
 * guarantee is worth anything.
 */
export const applyLocalOverrides = (
  base: unknown,
  local: unknown,
): TLocalResult => {
  if (!isRecord(local)) return { document: base, warnings: [] }
  if (!isRecord(base)) return { document: base, warnings: [] }

  const localDefaults = isRecord(local.defaults) ? local.defaults : {}
  const localSteps = isRecord(local.steps) ? local.steps : {}
  const localAgents = Array.isArray(local.agents) ? local.agents : []
  const named = localAgents.filter(isRecord)

  const stepKeys = new Set<string>(LOCAL_STEP_KEYS)
  refuse([
    ...Object.keys(local)
      .filter(
        (key) => key !== 'defaults' && key !== 'agents' && key !== 'steps',
      )
      .map((key) => `top-level '${key}'`),
    ...Object.keys(localSteps)
      .filter((key) => !stepKeys.has(key))
      .map((key) => `steps: '${key}'`),
    ...unsupported('defaults', localDefaults),
    ...named.flatMap((entry) =>
      unsupported(`agents[${String(entry.name ?? '?')}]`, entry),
    ),
  ])

  const patches = new Map(
    named
      .filter((entry) => typeof entry.name === 'string')
      .map((entry) => [entry.name as string, overridesOf(entry)]),
  )

  const baseAgents = Array.isArray(base.agents) ? base.agents : []
  const agents = baseAgents.map((agent) => {
    if (!isRecord(agent) || typeof agent.name !== 'string') return agent
    const patch = patches.get(agent.name)
    return patch === undefined ? agent : { ...agent, ...patch }
  })

  const rosterNames = new Set(
    baseAgents
      .filter(isRecord)
      .map((agent) => agent.name)
      .filter((name): name is string => typeof name === 'string'),
  )
  const warnings = [...patches.keys()]
    .filter((name) => !rosterNames.has(name))
    .map(
      (name) =>
        `local config names agent '${name}', which this roster does not have ` +
        '— that override did nothing',
    )

  return {
    document: {
      ...base,
      defaults: {
        ...(isRecord(base.defaults) ? base.defaults : {}),
        ...overridesOf(localDefaults),
      },
      // Replaced wholesale, not merged: an order is a sequence, and half of
      // one merged into another is neither.
      steps: { ...(isRecord(base.steps) ? base.steps : {}), ...localSteps },
      agents,
    },
    warnings,
  }
}

/**
 * Where a local layer would live for a given config path.
 *
 * Derived from the path in force rather than hardcoded, so `--config
 * other.yaml` looks for `other.local.yaml`. A developer who points the
 * factory somewhere else keeps their override alongside it.
 */
export const localConfigPath = (configPath: string): string =>
  configPath.replace(/(\.ya?ml)$/i, '.local$1')
