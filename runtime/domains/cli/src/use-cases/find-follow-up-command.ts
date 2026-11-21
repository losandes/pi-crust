import type { TPiCrustConfig } from '../../../../lib/contracts'
import type { TEnv } from '../../../../lib/system'
import { readRunState } from '../../../trace'
import { resolveLookupPaths } from '../../../workspace'
import { adviceCommand } from './advice'

export const findFollowUpCommand =
  (deps: Readonly<{ repoRoot: string; env: TEnv }>) =>
  (
    cfg: Readonly<Pick<TPiCrustConfig, 'defaults' | 'observability'>>,
    runId: string,
    prompt: string,
  ): string | undefined => {
    const state = readRunState(
      resolveLookupPaths(cfg, deps.repoRoot, deps.env).db,
      runId,
    )
    return state === undefined ? undefined : adviceCommand(state, prompt)
  }
