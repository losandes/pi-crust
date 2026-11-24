import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SKIP_INTEGRATION } from '../../../../testing/integration'
import { resolveGitToplevel } from './resolve-git-toplevel'

for (const repository of [true, false]) {
  test.skipIf(SKIP_INTEGRATION)(
    [
      `given Git ${repository}`,
      `when resolving a child directory`,
      `it should return the toplevel or absence`,
    ].join(', '),
    () => {
      // given
      const root = realpathSync(mkdtempSync(join(tmpdir(), 'crust-git-root-')))
      mkdirSync(join(root, 'a/b'), { recursive: true })
      if (repository)
        expect(spawnSync('git', ['init', '-q'], { cwd: root }).status).toBe(0)
      try {
        // when
        const result = resolveGitToplevel(join(root, 'a/b'))
        // then
        expect(result).toBe(repository ? root : undefined)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
  )
}
