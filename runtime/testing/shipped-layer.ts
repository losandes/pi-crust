import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { safeParseSettlement } from '../../lib/typedefs'
import { loadConfigWithNotes } from '../domains/config'
import type { TPiCrustConfig } from '../lib/contracts'
import type { TEnv } from '../lib/system'

export const SHIPPED_CONFIG_DIR = join(import.meta.dir, '../config')
export const EMPTY_REPOSITORY_PATH = join(
  import.meta.dir,
  'empty-repository.toml',
)
export const shippedEnv = (env: TEnv = process.env): TEnv => ({
  ...env,
  CRUST_PACKAGE_CONFIG: SHIPPED_CONFIG_DIR,
  CRUST_MACHINE_CONFIG: join(import.meta.dir, 'no-machine-config'),
})
export const SCRATCH_DATA_DIR = join(
  tmpdir(),
  `crust-test-no-data-${process.pid}`,
)
export const shippedConfig = (): TPiCrustConfig => {
  const config = loadConfigWithNotes(EMPTY_REPOSITORY_PATH, shippedEnv()).config
  return {
    ...config,
    defaults: { ...config.defaults, data_dir: SCRATCH_DATA_DIR },
  }
}

export const withShippedPackage = <TResult>(body: () => TResult): TResult => {
  const previous = process.env.CRUST_PACKAGE_CONFIG
  // biome-ignore lint/plugin/no-object-mutation: this test-only helper scopes the command input environment
  process.env.CRUST_PACKAGE_CONFIG = SHIPPED_CONFIG_DIR
  const previousData = process.env.CRUST_DATA_DIR
  // biome-ignore lint/plugin/no-object-mutation: scope the external environment for this callback
  if (previousData === undefined) process.env.CRUST_DATA_DIR = SCRATCH_DATA_DIR
  const result = safeParseSettlement(body)
  if (previousData === undefined) delete process.env.CRUST_DATA_DIR
  if (previous === undefined) delete process.env.CRUST_PACKAGE_CONFIG
  // biome-ignore lint/plugin/no-object-mutation: restore the external environment
  else process.env.CRUST_PACKAGE_CONFIG = previous
  if (result.status === 'error') throw result.error
  return result.data
}
