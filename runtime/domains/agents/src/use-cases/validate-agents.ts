/**
 * Fail fast: every required name must resolve to a usable agent.
 *
 * Nothing spawns against a half-valid config — this runs before the session is
 * even minted, so a misnamed agent costs a second rather than an activity run.
 */

import {
  errorMessage,
  safeParseSettlement,
} from '../../../../../lib/typedefs/src/settlement'
import type { TAgentConfig, TPiCrustConfig } from '../../../../lib/contracts'
import { isFile } from '../../../../lib/system'
import { resolveAgent } from '../../../config'
import { resolveModel } from '../data/pi-agent'
import { resolvePromptPath, resolveReference } from '../data/prompt-files'
/**
 * How a model pattern becomes a provider and a model id, or throws saying
 * why it cannot.
 *
 * A port, because the real one shells out to `pi --list-models`: a caller
 * that has no pi — a test, a runner — supplies its own rather than reading
 * a missing binary as "no model by that name exists".
 */
export type TResolveModel = (
  pattern: string,
) => Readonly<{ provider: string; modelId: string }>

const problemsForAgent = (
  name: string,
  agent: TAgentConfig,
  resolve: TResolveModel,
): readonly string[] => {
  const codingAgent =
    agent.coding_agent === 'pi'
      ? []
      : [
          `agent '${name}': coding_agent '${agent.coding_agent}' is not ` +
            'implemented in v1 (pi only)',
        ]

  const prompts = (
    [
      ['system', agent.prompt_engineering.system],
      ['user', agent.prompt_engineering.user],
      ...(agent.prompt_engineering.revise === undefined
        ? []
        : [['revise', agent.prompt_engineering.revise] as const]),
    ] as const
  ).flatMap(([label, ref]) =>
    isFile(resolvePromptPath(ref))
      ? []
      : [
          // Both paths: the reference is what a developer wrote, the
          // resolved path is where it was actually looked for, and reporting
          // only one of them sends them to the wrong place.
          `agent '${name}': ${label} prompt not found: ${ref} ` +
            `(looked in ${resolvePromptPath(ref)})`,
        ],
  )

  /*
   * An extension that cannot be opened kills the agent AFTER the session is
   * minted and the spend has started — pi exits 1 with "Extension path does
   * not exist", several paid Activity Runs into a chain. The same check the
   * prompts get costs nothing and moves it to before the run.
   */
  const extensions = agent.harness_engineering.flatMap((ref) =>
    isFile(resolveReference(ref))
      ? []
      : [
          `agent '${name}': harness extension not found: ${ref} ` +
            `(looked in ${resolveReference(ref)})`,
        ],
  )

  const model = safeParseSettlement(() => resolve(agent.model))
  const modelProblems =
    model.status === 'ok' ? [] : [`agent '${name}': ${model.error.message}`]

  return [...codingAgent, ...prompts, ...extensions, ...modelProblems]
}

const problemsFor = (
  cfg: TPiCrustConfig,
  name: string,
  resolve: TResolveModel,
): readonly string[] => {
  const resolved = safeParseSettlement(() => resolveAgent(cfg, name))
  return resolved.status === 'ok'
    ? problemsForAgent(name, resolved.data, resolve)
    : [errorMessage(resolved.error)]
}

export const validateAgents = (
  cfg: TPiCrustConfig,
  required: readonly string[],
  /** Defaults to this machine's pi catalogue; see `TResolveModel`. */
  resolve: TResolveModel = resolveModel,
): void => {
  const problems = required.flatMap((name) => problemsFor(cfg, name, resolve))
  if (problems.length > 0) {
    throw new Error(`config validation failed:\n- ${problems.join('\n- ')}`)
  }
}
