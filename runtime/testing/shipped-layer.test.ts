import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import {
  EMPTY_REPOSITORY_PATH,
  SCRATCH_DATA_DIR,
  SHIPPED_CONFIG_DIR,
  shippedConfig,
  shippedEnv,
  withShippedPackage,
} from './shipped-layer'

for (const throws of [false, true]) {
  test(
    [
      `given a shipped-package callback that ${throws ? 'throws' : 'returns'}`,
      'when run with the package layer enabled',
      'it should restore the external environment and propagate the result',
    ].join(', '),
    () => {
      // given
      const previous = process.env.CRUST_PACKAGE_CONFIG
      const previousData = process.env.CRUST_DATA_DIR
      // when
      const actual = () =>
        withShippedPackage(() => {
          if (throws) throw new Error('fixture failure')
          return process.env.CRUST_PACKAGE_CONFIG
        })
      // then
      if (throws) expect(actual).toThrow('fixture failure')
      else expect(actual()).toBe(SHIPPED_CONFIG_DIR)
      expect(process.env.CRUST_PACKAGE_CONFIG).toBe(previous)
      expect(process.env.CRUST_DATA_DIR).toBe(previousData)
    },
  )
}

test(
  [
    'given an initially unset package environment variable',
    'when a shipped callback finishes',
    'it should remove the temporary override',
  ].join(', '),
  () => {
    // given
    const previous = process.env.CRUST_PACKAGE_CONFIG
    delete process.env.CRUST_PACKAGE_CONFIG
    try {
      // when
      const actual = withShippedPackage(() => 'done')
      // then
      expect(actual).toBe('done')
      expect(process.env.CRUST_PACKAGE_CONFIG).toBeUndefined()
    } finally {
      // biome-ignore lint/plugin/no-object-mutation: this test fixture owns and restores the external configuration boundary
      if (previous !== undefined) process.env.CRUST_PACKAGE_CONFIG = previous
    }
  },
)

test(
  [
    'given the shipped configuration helper',
    'when requested with an explicit environment',
    'it should isolate the machine layer and load from an empty repository file',
  ].join(', '),
  () => {
    // given
    // when
    const env = shippedEnv({ EXTRA: 'kept' })
    const cfg = shippedConfig()
    // then
    expect(env.EXTRA).toBe('kept')
    expect(env.CRUST_PACKAGE_CONFIG).toBe(SHIPPED_CONFIG_DIR)
    expect(existsSync(env.CRUST_MACHINE_CONFIG ?? '')).toBe(false)
    expect(existsSync(EMPTY_REPOSITORY_PATH)).toBe(true)
    expect(cfg.defaults.data_dir).toBe(SCRATCH_DATA_DIR)
    expect(withShippedPackage(() => process.env.CRUST_DATA_DIR)).toBe(
      process.env.CRUST_DATA_DIR ?? SCRATCH_DATA_DIR,
    )
    expect(cfg.activities.some((entry) => entry.name === 'build')).toBe(true)
  },
)
