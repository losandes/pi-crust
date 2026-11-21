import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { TSettlement } from '../../../../../lib/typedefs'
import { safeParseSettlement } from '../../../../../lib/typedefs'
import { gitOutput } from './git'
import type { TRoots } from './roots'
import { fromGit, normaliseFromGit } from './roots'
import type { TTreeSnapshot } from './working-tree'

export const ABSENT = 'absent'

export const snapshotContent = (
  roots: TRoots,
  base: string,
): TSettlement<TTreeSnapshot> => {
  const commit = gitOutput(
    ['rev-parse', '--verify', '--quiet', `${base}^{commit}`],
    roots.vcsRoot,
  ).trim()
  if (commit === '') {
    return {
      status: 'error',
      error: new Error(`cannot resolve commit ${base}`),
    }
  }
  const paths = [
    ...gitOutput(
      ['diff', '--name-only', '--no-renames', '-z', base, '--'],
      roots.vcsRoot,
    ).split('\0'),
    ...gitOutput(
      ['ls-files', '--others', '--exclude-standard', '-z'],
      roots.vcsRoot,
    ).split('\0'),
  ].filter((path) => path !== '')
  return {
    status: 'ok',
    data: Object.fromEntries(
      paths.map((path) => {
        const content = safeParseSettlement(() =>
          readFileSync(fromGit(roots, path)),
        )
        return [
          normaliseFromGit(roots, path),
          content.status === 'ok'
            ? createHash('sha256').update(content.data).digest('hex')
            : ABSENT,
        ]
      }),
    ),
  }
}
