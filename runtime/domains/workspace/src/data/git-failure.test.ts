import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SKIP_INTEGRATION } from '../../../../testing/integration'

const source = new URL('./git.ts', import.meta.url).href

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
            `#!${process.execPath}`,
            "if (process.argv.includes('--git-dir')) process.exit(0)",
            outcome === 'signal'
              ? "process.kill(process.pid, 'SIGTERM')"
              : "process.stderr.write('fixture Git failure\\n'); process.exit(23)",
            '',
          ].join('\n'),
        )
        chmodSync(stub, 0o755)
        const script = `
          import { ${operation} } from ${JSON.stringify(source)}
          process.env.PATH = ${JSON.stringify(outcome === 'spawn-error' ? join(dir, 'absent') : dir)}
          try {
            ${
              operation === 'currentBranch'
                ? 'currentBranch()'
                : operation === 'commitPaths'
                  ? "commitPaths('fixture commit', ['work.txt'], process.cwd())"
                  : "pushBranch('fixture-remote', 'fixture-branch', process.cwd())"
            }
            process.stdout.write('unexpected success')
          } catch (error) {
            process.stdout.write(error.message)
          }
        `
        try {
          // when
          const message = execFileSync('bun', ['-e', script], {
            cwd: dir,
            encoding: 'utf8',
          })
          // then
          expect(message).toContain(`cwd: ${JSON.stringify(dir)}`)
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
          rmSync(dir, { recursive: true, force: true })
        }
      },
    )
  }
}
