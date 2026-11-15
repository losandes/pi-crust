import type { TAgentConfig, TPiCrustConfig } from '../../../../lib/contracts'
import { canonicalActivityName } from '../../../activities'
import type { TModelOverride } from '../../../cli'

type TOverriddenConfig = Readonly<{
  config: TPiCrustConfig
  warnings: readonly string[]
}>

export const applyModelOverrides = (
  cfg: TPiCrustConfig,
  overrides: readonly TModelOverride[],
  used: ReadonlySet<string>,
): TOverriddenConfig =>
  overrides.reduce<TOverriddenConfig>(
    ({ config, warnings }, override) => {
      const name = canonicalActivityName(cfg.activities, override.name)
      if (!cfg.agents.some((one) => one.name === name)) {
        return {
          config,
          warnings: [
            ...warnings,
            `--model: no activity named '${name}' in this repository — ignored`,
          ],
        }
      }

      const update = <TEntry extends Pick<TAgentConfig, 'name'>>(
        entry: TEntry,
      ): TEntry =>
        entry.name === name
          ? {
              ...entry,
              ...(override.model === undefined
                ? {}
                : { model: override.model }),
              ...(override.thinking === undefined
                ? {}
                : { thinking: override.thinking }),
            }
          : entry

      return {
        config: {
          ...config,
          agents: config.agents.map(update),
          activities: config.activities.map(update),
          planners: config.planners.map(update),
          terminal: config.terminal.map(update),
        },
        warnings: used.has(name)
          ? warnings
          : [
              ...warnings,
              `--model: '${name}' does not run in this run — the override has no effect`,
            ],
      }
    },
    { config: cfg, warnings: [] },
  )
