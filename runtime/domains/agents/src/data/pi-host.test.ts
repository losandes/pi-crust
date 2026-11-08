import { afterEach, expect, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { piLauncher, piReleaseDir } from './pi-host'

const PI_PATH = process.env.PI_PATH

/**
 * `process.env` is the external API the module reads, and pointing it at a
 * fixture is the only way to exercise discovery. Assigning to it is the
 * adapter, said once here rather than at every call site.
 */
const setPiPath = (value: string | undefined): void => {
  if (value === undefined) {
    delete process.env.PI_PATH
    return
  }
  // biome-ignore lint/plugin/no-object-mutation: process.env is the external API the module under test reads, and this function is the adapter that owns the assignment
  process.env.PI_PATH = value
}

afterEach(() => {
  setPiPath(PI_PATH)
})

/**
 * A managed install, as the launcher describes one:
 *
 *     <agent>/bin/pi
 *     <agent>/install/current-version
 *     <agent>/install/releases/<version>/node_modules
 */
const managedInstall = (
  version: string,
  withModules: boolean,
): Readonly<{ agentDir: string; launcher: string; release: string }> => {
  // realpath, because the launcher is resolved through symlinks and macOS
  // hands back /var/... for a /private/var/... temp directory.
  const agentDir = realpathSync(mkdtempSync(join(tmpdir(), 'crust-pi-host-')))
  mkdirSync(join(agentDir, 'bin'), { recursive: true })
  const launcher = join(agentDir, 'bin', 'pi')
  writeFileSync(launcher, '#!/bin/sh\n')
  mkdirSync(join(agentDir, 'install'), { recursive: true })
  writeFileSync(join(agentDir, 'install', 'current-version'), `${version}\n`)
  const release = join(agentDir, 'install', 'releases', version)
  mkdirSync(withModules ? join(release, 'node_modules') : release, {
    recursive: true,
  })
  return { agentDir, launcher, release }
}

test(
  [
    'given data/pi-host::piLauncher',
    'when PI_PATH names nothing on disk',
    'it should answer undefined rather than hand back a path that is not there',
  ].join(', '),
  () => {
    setPiPath(join(tmpdir(), 'crust-no-such-pi-launcher'))

    expect(piLauncher()).toBeUndefined()
  },
)

test(
  [
    'given data/pi-host::piReleaseDir',
    'when PI_PATH names a managed install',
    'it should find the release the current-version file points at',
  ].join(', '),
  () => {
    const install = managedInstall('9.9.9', true)
    setPiPath(install.launcher)

    try {
      expect(piReleaseDir()).toEqual(install.release)
    } finally {
      rmSync(install.agentDir, { recursive: true, force: true })
    }
  },
)

test(
  [
    'given data/pi-host::piReleaseDir',
    'when the named release has no node_modules',
    'it should answer undefined, because there is nothing there to resolve against',
  ].join(', '),
  () => {
    const install = managedInstall('9.9.9', false)
    setPiPath(install.launcher)

    try {
      expect(piReleaseDir()).toBeUndefined()
    } finally {
      rmSync(install.agentDir, { recursive: true, force: true })
    }
  },
)

test(
  [
    'given data/pi-host::piLauncher',
    'when PI_PATH is unset and no `pi` is anywhere on PATH',
    'it should answer undefined rather than guess',
  ].join(', '),
  () => {
    setPiPath(undefined)
    const originalWhich = Bun.which
    // biome-ignore lint/plugin/no-object-mutation: Bun.which has no PATH-independent fixture; stubbing the global is the only way to simulate no pi anywhere
    Bun.which = () => null

    try {
      expect(piLauncher()).toBeUndefined()
    } finally {
      // biome-ignore lint/plugin/no-object-mutation: restoring the global stubbed above
      Bun.which = originalWhich
    }
  },
)

test(
  [
    'given data/pi-host::piReleaseDir',
    'when there is no launcher to resolve at all',
    'it should answer undefined before touching the filesystem layout',
  ].join(', '),
  () => {
    setPiPath(undefined)
    const originalWhich = Bun.which
    // biome-ignore lint/plugin/no-object-mutation: Bun.which has no PATH-independent fixture; stubbing the global is the only way to simulate no pi anywhere
    Bun.which = () => null

    try {
      expect(piReleaseDir()).toBeUndefined()
    } finally {
      // biome-ignore lint/plugin/no-object-mutation: restoring the global stubbed above
      Bun.which = originalWhich
    }
  },
)

test(
  [
    'given data/pi-host::piReleaseDir',
    'when PI_PATH names a pi that is not a managed install',
    'it should answer undefined rather than guess at a layout',
  ].join(', '),
  () => {
    const dir = mkdtempSync(join(tmpdir(), 'crust-plain-pi-'))
    const launcher = join(dir, 'pi')
    writeFileSync(launcher, '#!/bin/sh\n')
    setPiPath(launcher)

    try {
      expect(piReleaseDir()).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
)
