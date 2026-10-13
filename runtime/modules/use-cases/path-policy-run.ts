/**
 * The path policy, as one agent call has to carry it.
 *
 * The decision itself is in `path-policy.ts` and the enforcement is in the
 * extension that runs inside pi (`harness-engineering/path-policy.ts`). This
 * is the join between them: what the runtime writes before a spawn, and what
 * it reads back afterwards.
 *
 * A file and an environment variable rather than an argument, because that is
 * the only channel available: pi loads an extension by path (`-e`) and passes
 * it nothing. Both live under the agent's own directory in the session
 * runtime, beside its prompts and its raw output, so a reader asking what an
 * agent was governed by finds the answer where everything else about that
 * call already is.
 */

import { join, resolve } from 'node:path'
import { fileExists, readText, writeText } from '../data/files'
import type { TPiCrustConfig } from '../typedefs/config'
import type { TPathIntent, TPathSettings, TRefusal } from './path-policy'
import { refusalLine } from './path-policy'

/** The variable the extension reads the policy file's path from. */
export const POLICY_ENV = 'CRUST_PATH_POLICY'

/**
 * Both files, named per Activity Run.
 *
 * Per run of the Activity and not per agent, because an agent's directory is
 * reused: the same builder running twice would otherwise append to one
 * record, and the second Activity Run would report the first one's refusals
 * as its own. The policy file is per Activity Run for the same reason in the
 * other direction — a local config layer may have changed between them.
 */
export const policyPaths = (
  agentDir: string,
  activityRunId: string,
): Readonly<{ policy: string; refusals: string }> => ({
  policy: resolve(join(agentDir, `path_policy_${activityRunId}.json`)),
  refusals: resolve(join(agentDir, `path_refusals_${activityRunId}.jsonl`)),
})

export const settingsFor = (
  cfg: TPiCrustConfig,
  repoRoot: string,
): TPathSettings => ({
  repoRoot: resolve(repoRoot),
  dataDir: cfg.defaults.data_dir.replace(/\/+$/, ''),
  protectedFiles: cfg.defaults.protected_files,
  protectedPolicy: cfg.defaults.protected,
  ignoredPolicy: cfg.defaults.ignored,
})

/**
 * Write the policy this call runs under, and return the variable naming it.
 *
 * Written every call rather than once per run: an agent's policy is its
 * config's, and a run whose local config layer changed between Activities
 * must not have the first Activity's answer applied to the last.
 */
export const armPolicy = (
  cfg: TPiCrustConfig,
  repoRoot: string,
  agentDir: string,
  activityRunId: string,
): Readonly<{ env: Readonly<Record<string, string>>; refusals: string }> => {
  const paths = policyPaths(agentDir, activityRunId)
  writeText(
    paths.policy,
    `${JSON.stringify(
      { ...settingsFor(cfg, repoRoot), refusalsPath: paths.refusals },
      null,
      2,
    )}\n`,
  )

  return { env: { [POLICY_ENV]: paths.policy }, refusals: paths.refusals }
}

const asIntent = (value: unknown): TPathIntent =>
  value === 'write' ? 'write' : 'read'

/**
 * Every governed call this agent made, from the record the extension wrote.
 *
 * A line that will not parse is dropped rather than failing the activity run:
 * the record of a refusal is worth less than the refusal itself, and the
 * refusal already happened inside the harness.
 */
export const refusalsIn = (path: string): readonly TRefusal[] => {
  if (!fileExists(path)) {
    return []
  }

  return readText(path)
    .split('\n')
    .filter((line) => line.trim() !== '')
    .flatMap((line) => {
      const settled = ((): Readonly<Record<string, unknown>> | undefined => {
        // biome-ignore lint/plugin: a half-written line is a dropped record, not a failed run
        try {
          return JSON.parse(line) as Readonly<Record<string, unknown>>
        } catch {
          return undefined
        }
      })()
      if (settled === undefined || typeof settled.path !== 'string') {
        return []
      }

      return [
        {
          tool: typeof settled.tool === 'string' ? settled.tool : '',
          path: settled.path,
          intent: asIntent(settled.intent),
          reason:
            settled.reason === 'protected' || settled.reason === 'ignored'
              ? settled.reason
              : 'ungoverned',
          verb:
            settled.verb === 'block' ||
            settled.verb === 'stop' ||
            settled.verb === 'warn'
              ? settled.verb
              : 'allow',
          bestEffort: settled.bestEffort === true,
        } satisfies TRefusal,
      ]
    })
}

/** What a `stop` costs: the Activity ends, loudly, naming what it reached for. */
export const stopMessage = (
  agent: string,
  stopped: readonly TRefusal[],
): string =>
  `${agent} reached a path this repository governs with 'stop':\n` +
  `${stopped.map((one) => `  - ${refusalLine(one)}`).join('\n')}\n` +
  'The call was not blocked, so assume it happened. Nothing was changed ' +
  'back; the policy is in crust.config.yaml under defaults.'
