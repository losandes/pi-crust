import { expect, test } from 'bun:test'
import {
  chmodSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { safeParseSettlement } from '../../../../../lib/typedefs'
import { SKIP_INTEGRATION } from '../../../../testing/integration'
import { commitPaths, currentBranch, pushBranch } from './git'

for (const operation of [
  'currentBranch',
  'commitPaths',
  'pushBranch',
] as const) {
  for (const outcome of ['exit', 'signal', 'spawn-error'] as const) {
    if (operation === 'commitPaths' && outcome === 'spawn-error') continue
    test.skipIf(SKIP_INTEGRATION)(
      [
        `given ${operation} with a Git ${outcome} failure`,
        'when the Git command fails',
        'it should retain argv cwd exit status signal and spawn error in the exception',
      ].join(', '),
      () => {
        // given
        const dir = realpathSync(
          mkdtempSync(join(tmpdir(), 'crust-git-failure-')),
        )
        writeFileSync(join(dir, 'work.txt'), 'staged work\n')
        const stub = join(dir, 'git')
        writeFileSync(
          stub,
          [
            '#!/bin/sh',
            '[ "$2" != --git-dir ] || exit 0',
            outcome === 'signal'
              ? 'kill -TERM "$$"'
              : "printf 'fixture Git failure\\n' >&2; exit 23",
            '',
          ].join('\n'),
        )
        chmodSync(stub, 0o755)
        const cwd = operation === 'currentBranch' ? process.cwd() : dir
        const invoke = {
          currentBranch,
          commitPaths: () => commitPaths('fixture commit', ['work.txt'], cwd),
          pushBranch: () => pushBranch('fixture-remote', 'fixture-branch', cwd),
        }[operation]
        const path = process.env.PATH
        const fixturePath =
          outcome === 'spawn-error' ? join(dir, 'absent') : dir
        try {
          // when
          // biome-ignore lint/plugin/no-object-mutation: isolate Git lookup for this synchronous test and restore PATH below
          process.env.PATH = fixturePath
          const result = safeParseSettlement(() => invoke())
          // then
          expect(result.status).toBe('error')
          const message = result.status === 'error' ? result.error.message : ''
          expect(message).toContain(`cwd: ${JSON.stringify(cwd)}`)
          expect(message).toContain('argv: ["git",')
          expect(message).toContain(
            `exit status: ${outcome === 'exit' ? '23' : 'unavailable'}`,
          )
          expect(message).toContain(
            `signal: ${outcome === 'signal' ? 'SIGTERM' : 'none'}`,
          )
          if (outcome === 'spawn-error') expect(message).toContain('ENOENT')
          else expect(message).toContain('spawn error: none')
          if (outcome === 'exit')
            expect(message).toContain('fixture Git failure')
          if (operation === 'currentBranch')
            expect(message).toContain(
              '["git","rev-parse","--abbrev-ref","HEAD"]',
            )
          if (operation === 'commitPaths')
            expect(message).toContain('["git","add","--","work.txt"]')
          if (operation === 'pushBranch')
            expect(message).toContain(
              '["git","push","--set-upstream","fixture-remote","fixture-branch"]',
            )
        } finally {
          if (path === undefined) delete process.env.PATH
          // biome-ignore lint/plugin/no-object-mutation: restore the test worker's Git lookup
          else process.env.PATH = path
          rmSync(dir, { recursive: true, force: true })
        }
      },
    )
  }
}
