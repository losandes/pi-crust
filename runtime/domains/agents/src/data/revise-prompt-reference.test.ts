import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { revisePromptReference } from './prompt-files'

for (const mode of ['configured', 'beside', 'fallback', 'directory'] as const) {
  test(
    [
      `given revise prompt resolution with ${mode}`,
      'when selecting a reference',
      'it should prefer configuration, then a sibling file, then user',
    ].join(', '),
    () => {
      // given
      const root = mkdtempSync(join(tmpdir(), 'crust-revise-reference-'))
      try {
        const user = join(root, 'user.md')
        const revise = join(root, 'revise.md')
        writeFileSync(user, 'user', { flag: 'wx' })
        if (mode === 'configured' || mode === 'beside') {
          writeFileSync(revise, 'revise', { flag: 'wx' })
        }
        if (mode === 'directory') mkdirSync(revise)
        const prompts = {
          system: join(root, 'system.md'),
          user,
          ...(mode === 'configured' ? { revise: join(root, 'custom.md') } : {}),
        }

        // when
        const actual = revisePromptReference(prompts)

        // then
        expect(actual).toBe(
          mode === 'configured'
            ? join(root, 'custom.md')
            : mode === 'beside'
              ? revise
              : prompts.user,
        )
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
  )
}

test(
  [
    'given a relative reference naming no file',
    'when selecting a revise prompt',
    'it should retain the user reference rather than resolve it',
  ].join(', '),
  () => {
    // given
    const prompts = {
      system: 'no-such-dir/system.md',
      user: 'no-such-dir/user.md',
    }

    // when
    const actual = revisePromptReference(prompts)

    // then
    expect(actual).toBe('no-such-dir/user.md')
  },
)
