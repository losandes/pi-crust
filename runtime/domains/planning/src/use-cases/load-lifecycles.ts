/** Canonicalize and validate the lifecycles already read by the configuration loader. */
import type {
  TLifecycleConfig,
  TPiCrustConfig,
} from '../../../../lib/contracts'
import { lifecycleFaults } from '../../../../lib/contracts'
import { canonicalActivityNames } from '../../../activities'
import { concurrencyFaults } from './concurrency-faults'

export const loadLifecycles = (
  cfg: TPiCrustConfig,
): readonly TLifecycleConfig[] => {
  const resolved = cfg.lifecycles.map((lifecycle) => ({
    ...lifecycle,
    stages: lifecycle.stages.map((stage) => ({
      ...stage,
      activities: [...canonicalActivityNames(cfg.activities, stage.activities)],
    })),
  }))
  const faults = resolved.flatMap((lifecycle) => [
    ...lifecycleFaults(lifecycle),
    ...concurrencyFaults(lifecycle, cfg.activities),
  ])
  if (faults.length > 0)
    throw new Error(
      `lifecycle configuration cannot run:\n${faults.map((fault) => `  ${fault.lifecycle}: ${fault.message}`).join('\n')}`,
    )
  return resolved
}
