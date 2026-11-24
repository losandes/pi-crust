import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveEnvFiles } from './resolve-env-files'

for (const mode of ['parent', 'override', 'nearer', 'none'] as const) {
  test(
    [
      `given ${mode} environment files`,
      `when resolved`,
      `it should use the nearest directory`,
    ].join(', '),
    () => {
      // given
      const root = mkdtempSync(join(tmpdir(), 'crust-env-'))
      const cwd = join(root, 'a/b')
      mkdirSync(cwd, { recursive: true })
      if (mode !== 'none')
        writeFileSync(join(root, '.env'), 'VALUE="two words"\nBASE=yes\n')
      if (mode === 'override')
        writeFileSync(join(root, '.env.local'), 'VALUE=local\n')
      if (mode === 'nearer')
        writeFileSync(join(root, 'a/.env.local'), 'NEAR=yes\n')
      try {
        // when
        const result = resolveEnvFiles(cwd)
        // then
        expect(result).toEqual(
          mode === 'none'
            ? {}
            : mode === 'nearer'
              ? { NEAR: 'yes' }
              : {
                  VALUE: mode === 'override' ? 'local' : 'two words',
                  BASE: 'yes',
                },
        )
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
  )
}
