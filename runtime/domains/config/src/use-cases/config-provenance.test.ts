import { expect, test } from 'bun:test'
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
          'db = "package.db"\n[defaults]\nmodel = "package-model"\nthinking = "high"\n',
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
      expect(entry('db')?.source).toContain(
        variable === 'none' ? 'shipped default —' : 'environment — CRUST_DB',
      )
      expect(entry('defaults.data_dir')?.source).toBe(
        variable === 'none'
          ? 'shipped default — built in'
          : 'environment — CRUST_DATA_DIR',
      )
    },
  )
}
