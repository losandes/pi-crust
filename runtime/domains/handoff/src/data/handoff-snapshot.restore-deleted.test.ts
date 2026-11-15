import { expect, test } from 'bun:test'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { readAll, restoreAll } from './handoff-snapshot'

for (const document of ['plan.md', 'reviews/plan_readiness.md']) {
  test(
    [
      `given a saved copy of the locked handoff document ${document}`,
      'when another activity deletes it and its saved copy is restored',
      'it should recreate the document and report it as restored',
    ].join(', '),
    () => {
      // given
      const dir = mkdtempSync(join(tmpdir(), 'crust-restore-deleted-'))
      using _scratch = {
        [Symbol.dispose]: () => rmSync(dir, { recursive: true, force: true }),
      }
      const path = join(dir, document)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, 'the original document')
      chmodSync(path, 0o444)
      const originals = readAll(dir, [document])
      rmSync(path)

      // when
      const restored = restoreAll(dir, originals, [document])

      // then
      expect(restored).toEqual([document])
      expect(readFileSync(path, 'utf8')).toBe('the original document')
    },
  )
}
