import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { safeParseSettlement, settledOr } from '../../typedefs'
import { repositoryPathOf, type TRepositoryIdentity } from './repository-path'

const gitOutput = (cwd: string, args: readonly string[]): string | undefined =>
  settledOr(
    safeParseSettlement(() => {
      const result = spawnSync('git', [...args], { cwd, encoding: 'utf8' })
      return result.status === 0 ? result.stdout.trim() || undefined : undefined
    }),
    undefined,
  )
const realPath = (path: string): string =>
  settledOr(
    safeParseSettlement(() => realpathSync(path)),
    resolve(path),
  )

export const readRepositoryIdentity = (cwd: string): TRepositoryIdentity => {
  const common = gitOutput(cwd, ['rev-parse', '--git-common-dir'])
  const commonDir =
    common === undefined ? undefined : realPath(resolve(cwd, common))
  return {
    originUrl: gitOutput(cwd, ['remote', 'get-url', 'origin']),
    primaryClone:
      commonDir === undefined
        ? realPath(cwd)
        : basename(commonDir) === '.git'
          ? dirname(commonDir)
          : commonDir,
  }
}
export const repositoryPathAt = (cwd: string): readonly string[] =>
  repositoryPathOf(readRepositoryIdentity(cwd))
