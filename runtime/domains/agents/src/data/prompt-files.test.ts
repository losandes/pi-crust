import { expect, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  promptFile,
  render,
  revisePromptPath,
  savePrompt,
} from './prompt-files'

for (const mode of ['present', 'absent', 'directory'] as const) {
  test(
    [
      `given a prompt directory with revise.md ${mode}`,
      'when resolving a revision',
      'it should use the revise file only when it is a regular file',
    ].join(', '),
    () => {
      // given
      const root = mkdtempSync(join(tmpdir(), 'crust-prompt-'))
      try {
        writeFileSync(join(root, 'user.md'), 'user')
        if (mode === 'present') writeFileSync(join(root, 'revise.md'), 'revise')
        if (mode === 'directory') mkdirSync(join(root, 'revise.md'))
        // when
        const actual = revisePromptPath(root)
        // then
        expect(actual).toBe(
          promptFile(root, mode === 'present' ? 'revise' : 'user'),
        )
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
  )
}

test(
  [
    'given a template path with repeated and unknown placeholders',
    'when rendered and saved',
    'it should read exactly that path, substitute supplied variables and preserve the audit bytes',
  ].join(', '),
  () => {
    // given
    const root = mkdtempSync(join(tmpdir(), 'crust-prompt-render-'))
    try {
      const path = join(root, 'system.md')
      writeFileSync(
        path,
        'Hello {{name}}, {{name}} is building {{thing}}. {{unknown}}\n',
      )
      // when
      const actual = render(path, { name: 'tester', thing: 'coverage' })
      const saved = savePrompt(join(root, 'audit'), 'sent.md', actual)
      // then
      expect(actual).toBe(
        'Hello tester, tester is building coverage. {{unknown}}\n',
      )
      expect(saved).toBe(join(root, 'audit/sent.md'))
      expect(readFileSync(saved, 'utf8')).toBe(actual)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  },
)

test(
  [
    'given a missing prompt directory',
    'when choosing its revision path',
    'it should retain the ordinary user path and let validation report missing files',
  ].join(', '),
  () => {
    // given
    // when
    const actual = revisePromptPath('no-such-dir')
    // then
    expect(actual).toBe('no-such-dir/user.md')
  },
)
