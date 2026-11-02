import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  applyMachineLayer,
  machineConfigPath,
  readMachineConfig,
} from './machine-config'

test(
  [
    'given use-cases/machine-config::machineConfigPath',
    'when CRUST_MACHINE_CONFIG is unset',
    'it should point at ~/.pi-crust/config/crust.config.yaml',
  ].join(', '),
  () => {
    // given
    const env = { HOME: '/home/dev' }

    // when
    const actual = machineConfigPath(env)

    // then
    expect(actual).toEqual('/home/dev/.pi-crust/config/crust.config.yaml')
  },
)

test(
  [
    'given use-cases/machine-config::machineConfigPath',
    'when CRUST_MACHINE_CONFIG names a path',
    'it should use that instead, so the loader can be tested without writing to a home directory',
  ].join(', '),
  () => {
    // given
    const env = { HOME: '/home/dev', CRUST_MACHINE_CONFIG: '/tmp/fixture.yaml' }

    // when
    const actual = machineConfigPath(env)

    // then
    expect(actual).toEqual('/tmp/fixture.yaml')
  },
)

test(
  [
    'given use-cases/machine-config::readMachineConfig',
    'when the machine file does not exist',
    'it should change nothing (1.2.1)',
  ].join(', '),
  () => {
    // given
    const env = { CRUST_MACHINE_CONFIG: '/does/not/exist/crust.config.yaml' }

    // when
    const actual = readMachineConfig(env)

    // then
    expect(actual).toEqual({
      path: '',
      ordinary: undefined,
      override: undefined,
    })
  },
)

const aMachineFile = (contents: string): string => {
  const dir = mkdtempSync(join(tmpdir(), 'crust-machine-config-'))
  const path = join(dir, 'crust.config.yaml')
  mkdirSync(dir, { recursive: true })
  writeFileSync(path, contents, 'utf8')
  return path
}

test(
  [
    'given use-cases/machine-config::readMachineConfig',
    'when the machine file has an override: section',
    'it should split it out of the ordinary document (1.2.5)',
  ].join(', '),
  () => {
    // given
    const path = aMachineFile(
      [
        'defaults:',
        '  model: anthropic/claude-sonnet-5',
        'override:',
        '  defaults:',
        '    data_dir: "{primary_worktree}/.pi-crust/data"',
        '',
      ].join('\n'),
    )

    // when
    const actual = readMachineConfig({ CRUST_MACHINE_CONFIG: path })

    // then
    expect(actual.ordinary).toEqual({
      defaults: { model: 'anthropic/claude-sonnet-5' },
    })
    expect(actual.override).toEqual({
      defaults: { data_dir: '{primary_worktree}/.pi-crust/data' },
    })
  },
)

test(
  [
    'given use-cases/machine-config::applyMachineLayer',
    'when the repository states a value the ordinary machine layer also states',
    'it should let the repository win (1.2.3: repository beats the ordinary layer)',
  ].join(', '),
  () => {
    // given
    const base = { defaults: { data_dir: 'repo-stated-value' } }
    const machine = {
      path: '/home/dev/.pi-crust/config/crust.config.yaml',
      ordinary: { defaults: { data_dir: 'machine-ordinary-value' } },
      override: undefined,
    }

    // when
    const actual = applyMachineLayer(base, machine)

    // then
    expect(
      (actual.document as { defaults: { data_dir: string } }).defaults.data_dir,
    ).toEqual('repo-stated-value')
  },
)

test(
  [
    'given use-cases/machine-config::applyMachineLayer',
    'when the repository states nothing for a key the ordinary layer sets',
    'it should fall through to the machine layer',
  ].join(', '),
  () => {
    // given
    const base = { defaults: {} }
    const machine = {
      path: '/home/dev/.pi-crust/config/crust.config.yaml',
      ordinary: { defaults: { model: 'openai/gpt-5.1' } },
      override: undefined,
    }

    // when
    const actual = applyMachineLayer(base, machine)

    // then
    expect(
      (actual.document as { defaults: { model: string } }).defaults.model,
    ).toEqual('openai/gpt-5.1')
  },
)

test(
  [
    'given use-cases/machine-config::applyMachineLayer',
    'when the machine declares an override: section',
    'it should beat the repository’s own stated value (1.2.2, 1.2.3)',
  ].join(', '),
  () => {
    // given — the repository states its own data_dir, same as any stamp does
    const base = { defaults: { data_dir: '.pi-crust/data' } }
    const machine = {
      path: '/home/dev/.pi-crust/config/crust.config.yaml',
      ordinary: undefined,
      override: { defaults: { data_dir: '{primary_worktree}/.pi-crust/data' } },
    }

    // when
    const actual = applyMachineLayer(base, machine)

    // then
    expect(
      (actual.document as { defaults: { data_dir: string } }).defaults.data_dir,
    ).toEqual('{primary_worktree}/.pi-crust/data')
  },
)

test(
  [
    'given use-cases/machine-config::applyMachineLayer',
    'when an ordinary key names an agent the base roster does not have',
    'it should warn rather than fail (1.2.9)',
  ].join(', '),
  () => {
    // given
    const base = { agents: [{ name: 'builder' }] }
    const machine = {
      path: '/home/dev/.pi-crust/config/crust.config.yaml',
      ordinary: undefined,
      override: { agents: [{ name: 'ghost', model: 'x' }] },
    }

    // when
    const actual = applyMachineLayer(base, machine)

    // then
    expect(actual.warnings.length).toBeGreaterThan(0)
  },
)
