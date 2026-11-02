import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from './checks'
import { EXIT } from './modules/typedefs/run-state'

const git = (cwd: string, ...args: readonly string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

/** A repository with one committed file and a config that declares a rule. */
const aRepoWith = (
  configYaml: string,
): Readonly<{ dir: string; configPath: string }> => {
  const dir = mkdtempSync(join(tmpdir(), 'crust-checks-cli-'))
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 'tester@example.com')
  git(dir, 'config', 'user.name', 'tester')
  git(dir, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(dir, 'README.md'), 'before\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', 'first')
  const configPath = join(dir, 'crust.config.yaml')
  writeFileSync(configPath, configYaml)

  return { dir, configPath }
}

/** `checkedPaths`/`loadConfig` read `process.cwd()`, so the test chdirs there. */
const inDir = <TResult>(dir: string, body: () => TResult): TResult => {
  const was = process.cwd()
  process.chdir(dir)
  try {
    return body()
  } finally {
    process.chdir(was)
  }
}

/** Capture what `main` printed, without depending on how it is painted. */
const captureStdout = <TResult>(
  body: () => TResult,
): Readonly<{
  result: TResult
  printed: string
}> => {
  const original = process.stdout.write.bind(process.stdout)
  let printed = ''
  // biome-ignore lint/plugin/no-object-mutation: swapping Node's own stdout.write for the capture, restored in finally
  process.stdout.write = ((chunk: string | Uint8Array) => {
    printed += typeof chunk === 'string' ? chunk : chunk.toString()
    return true
  }) as typeof process.stdout.write
  try {
    const result = body()
    return { result, printed }
  } finally {
    // biome-ignore lint/plugin/no-object-mutation: restoring Node's own stdout.write after the capture
    process.stdout.write = original
  }
}

test(
  [
    'given checks::main ("just crust verify")',
    'when a changed file matches no routing.checks rule',
    'it should exit success and print the same finding the gate reports, not a failure (1.2.3)',
  ].join(', '),
  () => {
    // given — a rule that can never reach a markdown file, and an untracked
    // change that is one
    const { dir } = aRepoWith(
      [
        'routing:',
        '  checks:',
        '    - name: lint',
        "      when: ['**/*.ts']",
        "      argv: ['true']",
        '',
      ].join('\n'),
    )
    writeFileSync(join(dir, 'NOTES.md'), 'a change nothing covers\n')

    // when
    const { result, printed } = inDir(dir, () =>
      captureStdout(() => main(['--config', 'crust.config.yaml'])),
    )

    // then — a developer running the checks by hand gets the same answer the
    // gate does: a reported gap, not a failed command (1.1.1, 1.2.3)
    expect(result).toEqual(EXIT.SUCCESS)
    expect(printed).toContain('NOTES.md')
  },
)

test(
  [
    'given checks::main ("just crust verify")',
    'when a changed file matches a declared rule and the command fails',
    'it should still exit failure, so an unmatched change settling as passed is not read as checks being advisory',
  ].join(', '),
  () => {
    // given
    const { dir } = aRepoWith(
      [
        'routing:',
        '  checks:',
        '    - name: lint',
        "      when: ['*.md']",
        '      argv: [sh, -c, "exit 1"]',
        '',
      ].join('\n'),
    )
    writeFileSync(join(dir, 'NOTES.md'), 'a change the rule covers\n')

    // when
    const { result } = inDir(dir, () =>
      captureStdout(() => main(['--config', 'crust.config.yaml'])),
    )

    // then
    expect(result).toEqual(EXIT.FAILED)
  },
)

test(
  [
    'given checks::main ("just crust verify")',
    'when the config declares no routing.checks rules at all',
    'it should say so and exit success',
  ].join(', '),
  () => {
    // given
    const { dir } = aRepoWith(['routing:', '  checks: []', ''].join('\n'))
    writeFileSync(join(dir, 'NOTES.md'), 'a change\n')

    // when
    const { result, printed } = inDir(dir, () =>
      captureStdout(() => main(['--config', 'crust.config.yaml'])),
    )

    // then
    expect(result).toEqual(EXIT.SUCCESS)
    expect(printed).toContain('no checks')
  },
)

test(
  [
    'given checks::main ("just crust verify")',
    'when nothing has changed in the working tree',
    'it should say so and exit success',
  ].join(', '),
  () => {
    // given — a rule exists, but there is no diff for it to apply to.
    // The config itself is committed, so writing it does not count as a change.
    const { dir } = aRepoWith(
      [
        'routing:',
        '  checks:',
        '    - name: lint',
        "      when: ['**/*.ts']",
        "      argv: ['true']",
        '',
      ].join('\n'),
    )
    git(dir, 'add', '-A')
    git(dir, 'commit', '-qm', 'config')

    // when
    const { result, printed } = inDir(dir, () =>
      captureStdout(() => main(['--config', 'crust.config.yaml'])),
    )

    // then
    expect(result).toEqual(EXIT.SUCCESS)
    expect(printed).toContain('nothing changed')
  },
)
