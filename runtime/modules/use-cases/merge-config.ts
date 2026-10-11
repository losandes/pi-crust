/**
 * A developer's private overrides of the committed config.
 *
 * `crust.config.yaml` is the repository's answer and is reviewed. A local
 * layer beside it, gitignored, answers the questions that are one person's:
 * which model their licence reaches, how much thinking that model supports,
 * how fast they want the trace UI to poll.
 *
 * It may set anything the base file can, key by key, with the local value
 * winning. There is no restricted subset: whoever writes this file can
 * equally edit the committed one, and runs the result on their own machine
 * against their own checkout, so there is no second principal to protect and
 * a restriction would only be friction in the file whose purpose is to have
 * none.
 *
 * Activities are not here. They live in `crust.activities.yaml` and merge
 * through `mergeActivities`, which is the same rule applied to a registry
 * rather than to a document.
 *
 * An unknown key is kept rather than refused. The schema downstream decides
 * what is valid, and this module deciding separately would mean two places
 * that disagree the first time one of them is extended.
 */

type TRecord = Record<string, unknown>

const isRecord = (value: unknown): value is TRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** What a local layer did, and what it could not reach. */
export type TLocalResult = Readonly<{
  /** the merged document, ready for the schema */
  document: unknown
  /** names the base config does not have — said, never fatal */
  warnings: readonly string[]
}>

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

  /** Per key, with the local value winning; nested objects merge. */
  const mergeInto = (left: TRecord, right: TRecord): TRecord =>
    Object.entries(right).reduce<TRecord>(
      (merged, [key, value]) => ({
        ...merged,
        [key]:
          isRecord(value) && isRecord(merged[key])
            ? mergeInto(merged[key], value)
            : value,
      }),
      left,
    )

  const localAgents = Array.isArray(local.agents)
    ? local.agents.filter(isRecord)
    : []
  const baseAgents = Array.isArray(base.agents) ? base.agents : []
  const patches = new Map(
    localAgents
      .filter((entry) => typeof entry.name === 'string')
      .map((entry) => [entry.name as string, entry] as const),
  )
  const agents = baseAgents.map((agent) => {
    if (!isRecord(agent) || typeof agent.name !== 'string') return agent
    const patch = patches.get(agent.name)

    return patch === undefined ? agent : mergeInto(agent, patch)
  })

  /*
   * A name the base does not have is a WARNING rather than a failure.
   *
   * It goes stale when somebody renames an Activity upstream, and a
   * colleague's private file must not break everyone's runs. An override
   * that silently did nothing would be worse, so it is said out loud — and
   * adding an Activity belongs in `crust.activities.local.yaml`, where it
   * reaches the registry rather than patching a document.
   */
  const known = new Set(
    baseAgents
      .filter(isRecord)
      .map((agent) => agent.name)
      .filter((name): name is string => typeof name === 'string'),
  )
  const warnings = [...patches.keys()]
    .filter((name) => !known.has(name))
    .map(
      (name) =>
        `local config names agent '${name}', which this config does not ` +
        'have — that override did nothing. Activities are registered in ' +
        'crust.activities.yaml.',
    )

  const merged = mergeInto(base, local)

  return {
    document: baseAgents.length === 0 ? merged : { ...merged, agents },
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
