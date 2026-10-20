/**
 * Where the pi host this machine runs actually keeps its modules.
 *
 * A pi extension imports `@earendil-works/*` and `typebox` and gets them from
 * the host process, never from this repository. To check that those imports
 * still resolve, something has to find the host's own module tree — and the
 * managed installer's launcher says exactly where it is:
 *
 *     <agent-dir>/bin/pi                      the launcher, possibly a symlink
 *     <agent-dir>/install/current-version     one line, the version in use
 *     <agent-dir>/install/releases/<version>  the tree, with node_modules
 *
 * Any other installation — an npm global, a checkout, a container with no pi
 * at all — yields `undefined` rather than a guess. A caller that cannot find
 * the host has not learned that an import is broken; it has learned nothing,
 * and should say so instead of failing.
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** `PI_PATH`, else `pi` on PATH, with symlinks followed. */
export const piLauncher = (): string | undefined => {
  const named = process.env.PI_PATH ?? Bun.which('pi') ?? undefined
  if (named === undefined || named === '') {
    return undefined
  }
  // biome-ignore lint/plugin/no-intermediate-try-catch: the boundary — the path comes from the environment and may name nothing
  try {
    return realpathSync(named)
  } catch {
    return undefined
  }
}

/**
 * The release directory of the managed pi install, or `undefined` when this
 * is not one. Resolve against it: `node_modules` sits directly inside.
 */
export const piReleaseDir = (): string | undefined => {
  const launcher = piLauncher()
  if (launcher === undefined) {
    return undefined
  }
  const agentDir = dirname(dirname(launcher))
  const versionFile = join(agentDir, 'install', 'current-version')
  if (!existsSync(versionFile)) {
    return undefined
  }
  const version = readFileSync(versionFile, 'utf8').trim()
  if (version === '') {
    return undefined
  }
  const release = join(agentDir, 'install', 'releases', version)
  return existsSync(join(release, 'node_modules')) ? release : undefined
}

/** Whether `specifier` resolves from `dir`. No import is executed. */
export const resolvesFrom = (specifier: string, dir: string): boolean => {
  // biome-ignore lint/plugin/no-intermediate-try-catch: resolveSync throws for "not found", which is the answer being asked for
  try {
    Bun.resolveSync(specifier, dir)
    return true
  } catch {
    return false
  }
}
