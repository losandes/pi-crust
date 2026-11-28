import { homedir } from 'node:os'

type TEnv = Readonly<Record<string, string | undefined>>

export const redactPathsFromEnv = (env: TEnv = process.env): boolean =>
  env.CRUST_REDACT_PATHS !== 'false'

export const homeDirFromEnv = (
  env: TEnv = process.env,
  osHome: () => string = homedir,
): string => (env.HOME?.trim() ? env.HOME : osHome())
