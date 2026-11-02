/**
 * Resolving `defaults.data_dir` and `observability.db` to absolute paths.
 *
 * Issue #24 (1.1): every consumer composed the configured value itself —
 * sometimes against the repository root, sometimes against `process.cwd()` —
 * so the two disagreed as soon as something ran `just` from somewhere other
 * than the repository root. One function, called everywhere, settles it.
 *
 * Resolution, in order:
 *   1. expand a leading `~` to the user's home directory
 *   2. expand the `{primary_worktree}` token, if present
 *   3. use the result unchanged when it is already absolute
 *   4. otherwise resolve it against the repository root
 */

import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { dataDirFromEnv, type TEnv } from './env-overrides'

export const PRIMARY_WORKTREE_TOKEN = '{primary_worktree}'

const run = (
  args: readonly string[],
  cwd: string,
): Readonly<{ status: number; stdout: string }> => {
  const result = spawnSync('git', [...args], { cwd, encoding: 'utf8' })
  return { status: result.status ?? 1, stdout: (result.stdout ?? '').trim() }
}

/**
 * `{primary_worktree}` resolved from `repoRoot` (1.1.3, 1.1.4, 1.1.5).
 *
 * A main clone answers itself; a linked worktree answers the clone it came
 * from, through `dirname(git rev-parse --git-common-dir)`. Falling back to
 * `repoRoot` when git fails or the tree is not a repository is the same
 * fallback `vcsRoot` already takes (`git.ts`).
 *
 * A bare clone — `--git-common-dir` naming the repository itself, with no
 * working tree at its parent — is refused rather than resolved, because the
 * parent of a bare repository is not this clone's data; it is whatever
 * directory happens to hold the bare repository.
 */
export const primaryWorktree = (repoRoot: string): string => {
  const commonDir = run(['rev-parse', '--git-common-dir'], repoRoot)
  if (commonDir.status !== 0 || commonDir.stdout === '') {
    return repoRoot
  }
  const absoluteCommonDir = isAbsolute(commonDir.stdout)
    ? commonDir.stdout
    : resolve(repoRoot, commonDir.stdout)
  const bare = run(['rev-parse', '--is-bare-repository'], repoRoot)
  if (bare.stdout === 'true') {
    throw new Error(
      `{primary_worktree} cannot expand: git-common-dir names a bare ` +
        `repository at ${absoluteCommonDir}, which has no working tree at ` +
        `its parent. Resolving against ${dirname(absoluteCommonDir)} would ` +
        'write into the directory that holds the bare repository, not a ' +
        'clone of it.',
    )
  }
  return resolve(dirname(absoluteCommonDir))
}

const expandHome = (value: string): string =>
  value === '~' || value.startsWith('~/')
    ? join(homedir(), value.slice(1))
    : value

/**
 * Resolve one configured path (a `data_dir` or a `db`) to an absolute path.
 *
 * `repoRoot` is the base for a relative value (1.1.6) — never
 * `process.cwd()`, so the result agrees regardless of where `just` was
 * invoked from.
 */
export const resolveConfiguredPath = (
  value: string,
  repoRoot: string,
): string => {
  const withHome = expandHome(value)
  const withToken = withHome.includes(PRIMARY_WORKTREE_TOKEN)
    ? withHome.replaceAll(PRIMARY_WORKTREE_TOKEN, primaryWorktree(repoRoot))
    : withHome
  return isAbsolute(withToken) ? withToken : resolve(repoRoot, withToken)
}

export type TResolvedDataPaths = Readonly<{
  dataDir: string
  db: string
}>

export type TDataPathsConfig = Readonly<{
  defaults: Readonly<{ data_dir: string }>
  observability: Readonly<{ db: string }>
}>

/**
 * `defaults.data_dir` and `observability.db`, resolved to absolute paths.
 *
 * `CRUST_DATA_DIR` overrides the configured `data_dir` before resolution
 * (1.1.7); there is no equivalent override for `db` here — `CRUST_DB`
 * already exists and is handled by each consumer alongside its other
 * flag/env precedence, same as it always was.
 */
export const resolveDataPaths = (
  cfg: TDataPathsConfig,
  repoRoot: string,
  env: TEnv = process.env,
): TResolvedDataPaths => {
  const dataDirValue = dataDirFromEnv(env) ?? cfg.defaults.data_dir
  return {
    dataDir: resolveConfiguredPath(dataDirValue, repoRoot),
    db: resolveConfiguredPath(cfg.observability.db, repoRoot),
  }
}
