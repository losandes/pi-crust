import { expect, test } from 'bun:test'
import {
  EMPTY_REPOSITORY_PATH,
  shippedEnv,
} from '../../../../testing/shipped-layer'
import { layersFixture } from './config-layer-fixture.test'
import { configProvenance } from './config-provenance'

for (const variable of ['none', 'valid', 'invalid']) {
  test(
    [
      `given @SC22 layered values and ${variable} environment overrides`,
      'when provenance is requested',
      'it should report effective values with the last stating layer and inherited source',
    ].join(', '),
    () => {
      // given
      using f = layersFixture({
        'package/crust.config.toml':
          '[defaults]\nmodel = "package-model"\nthinking = "high"\n',
        'package/crust.activities.toml':
          '[activities.build]\nwrites = []\n[planners.operator]\nwrites = []\n[planners.triage]\nwrites = []\n[terminal.gh-pull-request]\nwrites = []\n',
        'machine/crust.config.toml':
          'poll_ms = 250\n[ports]\nbackend = 4700\nfrontend = 4701\n',
        'machine/crust.activities.toml':
          '[activities.build]\nmodel = "machine-model"\n[terminal.gh-pull-request]\ndelivery = { draft = true }\n',
        'repository/pi-crust.toml':
          '[terminal.gh-pull-request]\ndelivery = { base = "develop" }\n[lifecycles.quick]\nstages = [{ name = "work", serial = ["build"] }]\n',
      })
      const env = {
        ...f.env,
        ...(variable === 'none'
          ? {}
          : {
              CRUST_DB: 'environment.db',
              CRUST_DATA_DIR: '/environment/data',
              CRUST_BE_PORT: variable === 'valid' ? '4800' : 'bad',
              CRUST_FE_PORT: variable === 'valid' ? '4801' : '0',
            }),
      }
      // when
      const actual = configProvenance(f.repositoryPath, env)
      const entry = (key: string) => actual.find((one) => one.key === key)
      // then
      expect(entry('activities.build.model')).toMatchObject({
        value: 'machine-model',
        source: `machine — ${f.root}/machine/crust.activities.toml`,
      })
      expect(entry('activities.build.thinking')?.source).toContain(
        '(via defaults.thinking)',
      )
      expect(
        entry('terminal.gh-pull-request.delivery.remote')?.value,
      ).toBeUndefined()
      expect(entry('terminal.gh-pull-request.delivery.base')?.source).toBe(
        `repository — ${f.repositoryPath}`,
      )
      expect(entry('terminal.gh-pull-request.delivery.draft')?.value).toBe(true)
      expect(entry('lifecycles.quick.stages')?.value).toEqual(['work'])
      expect(entry('defaults.color')?.source).toBe('shipped default — built in')
      expect(entry('ports.backend')?.value).toBe(
        variable === 'valid' ? 4800 : 4700,
      )
      expect(entry('ports.frontend')?.source).toContain(
        variable === 'valid' ? 'environment — CRUST_FE_PORT' : 'machine —',
      )
      expect(entry('db')).toBeUndefined()
      expect(entry('defaults.data_dir')?.source).toBe(
        variable === 'none'
          ? 'shipped default — built in'
          : 'environment — CRUST_DATA_DIR',
      )
    },
  )
}

test(
  [
    'given the shipped data location and no overrides',
    'when configuration provenance is reported',
    'it should show exactly one location from the shipped defaults',
  ].join(', '),
  () => {
    // given
    const env = shippedEnv({})
    // when
    const entries = configProvenance(EMPTY_REPOSITORY_PATH, env)
    const locations = entries.filter((entry) => entry.key.includes('data_dir'))
    // then
    expect(locations.length).toBe(1)
    expect(locations[0]?.value).toBe('~/.pi-crust/data')
    expect(locations[0]?.source).toStartWith('shipped default — ')
    expect(locations[0]?.source).toEndWith('runtime/config/crust.config.toml')
    expect(entries.some((entry) => entry.key === 'db')).toBe(false)
  },
)
