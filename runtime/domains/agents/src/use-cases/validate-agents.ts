/**
 * Fail fast: every required name must resolve to a usable agent.
 *
 * Nothing spawns against a half-valid config — this runs before the session is
 * even minted, so a misnamed agent costs a second rather than an activity run.
 */

import { errorMessage, safeParseSettlement } from '../../../../../lib/typedefs'
import type { TAgentConfig, TPiCrustConfig } from '../../../../lib/contracts'
import { isFile } from '../../../../lib/system'
import { resolveAgent } from '../../../config'
import { resolveModel } from '../data/pi-agent'
import { promptFile } from '../data/prompt-files'
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

  const prompts = (['system', 'user'] as const).flatMap((kind) =>
    isFile(promptFile(agent.prompts, kind))
      ? []
      : [`agent '${name}': ${kind}.md not found in ${agent.prompts}`],
  )

  const model = safeParseSettlement(() => resolve(agent.model))
  const modelProblems =
    model.status === 'ok' ? [] : [`agent '${name}': ${model.error.message}`]

  return [...codingAgent, ...prompts, ...modelProblems]
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
