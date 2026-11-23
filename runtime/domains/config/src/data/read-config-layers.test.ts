import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { DEFAULT_CONFIG_PATH } from '../../../../lib/contracts'
import { layersFixture } from '../use-cases/config-layer-fixture.test'
import { readConfigLayers } from './read-config-layers'

test(
  [
    'given no package override and an isolated HOME',
    'when reading the default package layer',
    'it should locate the real runtime/config files and the machine directory without reading the developer home',
  ].join(', '),
  () => {
    // given
    using f = layersFixture()
    const home = join(f.root, 'isolated-home')
    // when
    const actual = readConfigLayers(f.repositoryPath, { HOME: home })
    // then
    expect(actual.status).toBe('ok')
    if (actual.status === 'ok') {
      expect(actual.data.layers[0]?.files).toHaveLength(3)
      expect(actual.data.layers[0]?.promptRoot).toBe(
        join(import.meta.dir, '../../../..'),
      )
      expect(actual.data.machineDirectory).toBe(join(home, '.pi-crust/config'))
    }
  },
)

test(
  [
    'given no repository file at the default relative path',
    'when reading in a disposable directory',
    'it should contribute an empty repository layer rather than fail',
  ].join(', '),
  () => {
    // given
    using f = layersFixture()
    const cwd = process.cwd()
    process.chdir(f.root)
    try {
      // when
      const actual = readConfigLayers(DEFAULT_CONFIG_PATH, f.env)
      // then
      expect(actual.status).toBe('ok')
      if (actual.status === 'ok')
        expect(actual.data.layers[2]?.files).toEqual([])
    } finally {
      process.chdir(cwd)
    }
  },
)

for (const [name, content, expected] of [
  ['repository/pi-crust.toml', '[broken', 'repository/pi-crust.toml'],
  ['package/crust.config.toml', '[broken', 'package/crust.config.toml'],
  ['machine/crust.config.toml', '[broken', 'machine/crust.config.toml'],
]) {
  test(
    [
      `given invalid TOML in ${name}`,
      'when layer files are read',
      'it should settle the parse failure with the filename',
    ].join(', '),
    () => {
      // given
      using f = layersFixture({ [name]: content })
      // when
      const actual = readConfigLayers(f.repositoryPath, f.env)
      // then
      expect(actual.status).toBe('error')
      if (actual.status === 'error')
        expect(actual.error.message).toContain(expected)
    },
  )
}

test(
  [
    'given three directories and legacy paths',
    'when layers are read',
    'it should gather TOML only and report legacy filenames without parsing them',
  ].join(', '),
  () => {
    // given
    using f = layersFixture({
      'repository/.pi-crust/config/crust.config.yaml': '[not TOML or YAML',
      'repository/.pi-crust/config/crust.activities.local.yml': 'ignored',
      'repository/.pi-crust/config/crust.activities.example.yaml': 'example',
      'repository/.pi-crust/config/unrelated.yaml': 'unrelated',
      'machine/crust.config.yaml': 'ignored',
      'machine/crust.config.toml': 'poll_ms = 250\n',
    })
    // when
    const actual = readConfigLayers(f.repositoryPath, f.env)
    // then
    expect(actual.status).toBe('ok')
    if (actual.status === 'ok') {
      expect(actual.data.layers.map((layer) => layer.name)).toEqual([
        'package',
        'machine',
        'repository',
      ])
      expect(actual.data.layers[1]?.document).toEqual({ poll_ms: 250 })
      expect(actual.data.legacy.repositoryFiles).toEqual([
        'crust.activities.local.yml',
        'crust.config.yaml',
      ])
      expect(actual.data.legacy.machineFile).toBe(
        join(f.root, 'machine/crust.config.yaml'),
      )
    }
  },
)

test(
  [
    'given an explicitly selected missing repository file',
    'when read',
    'it should fail rather than silently use defaults',
  ].join(', '),
  () => {
    // given
    using f = layersFixture()
    const path = join(f.root, 'missing.toml')
    // when
    const actual = readConfigLayers(path, f.env)
    // then
    expect(actual.status).toBe('error')
    if (actual.status === 'error') expect(actual.error.message).toContain(path)
  },
)

test(
  [
    'given CRUST_MACHINE_CONFIG naming a regular file',
    'when read',
    'it should leave the machine layer empty and announce the old variable usage',
  ].join(', '),
  () => {
    // given
    using f = layersFixture({ 'old-machine.yaml': 'ignored' })
    const path = join(f.root, 'old-machine.yaml')
    // when
    const actual = readConfigLayers(f.repositoryPath, {
      ...f.env,
      CRUST_MACHINE_CONFIG: path,
    })
    // then
    expect(actual.status).toBe('ok')
    if (actual.status === 'ok') {
      expect(actual.data.layers[1]?.files).toEqual([])
      expect(actual.data.legacy.machineVariableFile).toBe(path)
    }
  },
)
