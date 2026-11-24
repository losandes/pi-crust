import { expect, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveCrustHome } from './resolve-crust-home'

for (const mode of [
  'unset',
  'empty',
  'whitespace',
  'own',
  'symlink',
  'other',
  'invalid',
  'relative',
  'absent',
] as const) {
  test(
    [
      `given ${mode} CRUST_HOME`,
      `when resolved`,
      `it should select or refuse the checkout`,
    ].join(', '),
    () => {
      // given
      const root = mkdtempSync(join(tmpdir(), 'crust-home-'))
      const own = join(root, 'own')
      const other = join(root, 'other')
      mkdirSync(own)
      mkdirSync(join(other, 'runtime'), { recursive: true })
      writeFileSync(join(other, 'runtime/cli.ts'), '')
      symlinkSync(own, join(root, 'link'))
      const values = {
        unset: undefined,
        empty: '',
        whitespace: '  ',
        own,
        symlink: join(root, 'link'),
        other,
        invalid: root,
        relative: 'other',
        absent: join(root, 'absent'),
      }
      try {
        // when
        const actual = resolveCrustHome(values[mode], root, own)
        // then
        expect(actual).toEqual(
          ['other', 'relative'].includes(mode)
            ? { kind: 'other', cli: join(other, 'runtime/cli.ts') }
            : ['invalid', 'absent'].includes(mode)
              ? { kind: 'invalid', home: values[mode] }
              : { kind: 'own' },
        )
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
  )
}
