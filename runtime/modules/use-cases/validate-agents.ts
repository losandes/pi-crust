/**
 * Fail fast: every required name must resolve to a usable agent.
 *
 * Nothing spawns against a half-valid config — this runs before the session is
 * even minted, so a misnamed agent costs a second rather than an activity run.
 */

import { isFile } from '../data/files'
import { resolvePromptPath, resolveReference } from '../data/prompt-files'
import { resolveModel } from '../data/pi-agent'
import type { TAgentConfig, TPiCrustConfig } from '../typedefs/config'
import { errorMessage, safeParseSettlement } from '../typedefs/settlement'
import { resolveAgent } from './load-config'

const problemsForAgent = (
  name: string,
  agent: TAgentConfig,
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

  const model = safeParseSettlement(() => resolveModel(agent.model))
  const modelProblems =
    model.status === 'ok' ? [] : [`agent '${name}': ${model.error.message}`]

  return [...codingAgent, ...prompts, ...extensions, ...modelProblems]
}

const problemsFor = (cfg: TPiCrustConfig, name: string): readonly string[] => {
  const resolved = safeParseSettlement(() => resolveAgent(cfg, name))
  return resolved.status === 'ok'
    ? problemsForAgent(name, resolved.data)
    : [errorMessage(resolved.error)]
}

export const validateAgents = (
  cfg: TPiCrustConfig,
  required: readonly string[],
): void => {
  const problems = required.flatMap((name) => problemsFor(cfg, name))
  if (problems.length > 0) {
    throw new Error(`config validation failed:\n- ${problems.join('\n- ')}`)
  }
}
