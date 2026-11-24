/**
 * The two paths an engineer overrides from the environment.
 *
 * `CRUST_CONFIG` and `CRUST_DB` already existed as the visualizer's way in and
 * as the justfile's way to pass `--config` through, so a developer who met
 * either one reasonably expected the rest of the factory to honour it. It did
 * not, and the failure was silent: the variable was set, the run used the
 * default, and nothing said why.
 *
 * Precedence is flag, then environment, then config, then built-in default.
 * The explicit argument always wins, because a flag is typed for one command
 * while an exported variable outlives the terminal it was set in.
 *
 * An empty or whitespace-only value reads as unset rather than as a path of
 * `''`, so `CRUST_DB= crust report` behaves like not setting it at all.
 *
 * The environment arrives as an argument so a caller can hand over a plain
 * object. Mutating `process.env` to exercise this would be both a shared
 * global and a trap: deleting a key is the only way to unset one, and the
 * obvious alternative assigns the STRING "undefined".
 */

export type TEnv = Readonly<Record<string, string | undefined>>

const trimmedOrUndefined = (value: string | undefined): string | undefined => {
  const text = (value ?? '').trim()
  return text === '' ? undefined : text
}

/** `CRUST_CONFIG`, when it names something. */
export const configPathFromEnv = (
  env: TEnv = process.env,
): string | undefined => trimmedOrUndefined(env.CRUST_CONFIG)

/** `CRUST_DB`, when it names something. */
export const dbPathFromEnv = (env: TEnv = process.env): string | undefined =>
  trimmedOrUndefined(env.CRUST_DB)

/** `CRUST_DATA_DIR`, when it names something — overrides `defaults.data_dir` (1.1.7). */
export const dataDirFromEnv = (env: TEnv = process.env): string | undefined =>
  trimmedOrUndefined(env.CRUST_DATA_DIR)

/** Directory holding this machine's three TOML configuration files. */
export const machineConfigDirFromEnv = (
  env: TEnv = process.env,
): string | undefined => trimmedOrUndefined(env.CRUST_MACHINE_CONFIG)

/** Directory holding the package's three TOML configuration files. */
export const packageConfigDirFromEnv = (
  env: TEnv = process.env,
): string | undefined => trimmedOrUndefined(env.CRUST_PACKAGE_CONFIG)
