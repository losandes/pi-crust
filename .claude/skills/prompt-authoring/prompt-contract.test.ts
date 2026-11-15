import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const CHECKER = join(import.meta.dir, 'scripts', 'prompt-contract.ts')
const SHELL_CHECKER = join(import.meta.dir, 'scripts', 'check-prompt.sh')
const SHIPPED_PROMPT = 'runtime/prompt-engineering/build/user.md'

const withReport = (example: string): string =>
  [
    '# Example Task',
    '',
    '## Variables',
    '',
    '## Intake',
    '',
    '## Task',
    '',
    '## Report',
    '',
    example,
    '',
  ].join('\n')

const checkPrompt = (
  text: string,
  {
    relativePath = SHIPPED_PROMPT,
    baseline,
    scope,
  }: Readonly<{
    relativePath?: string
    baseline?: string
    scope?: 'all' | 'given'
  }> = {},
) => {
  const root = mkdtempSync(join(tmpdir(), 'crust-prompt-contract-'))
  try {
    const path = join(root, relativePath)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text, { flag: 'wx' })
    const baselinePath = join(root, 'baseline.md')
    if (baseline !== undefined) {
      writeFileSync(baselinePath, baseline, { flag: 'wx' })
    }
    const command =
      scope === undefined
        ? [
            'bun',
            CHECKER,
            '--root',
            root,
            '--',
            path,
            baseline === undefined ? '-' : baselinePath,
          ]
        : ['bash', SHELL_CHECKER, scope === 'all' ? '--all' : path]
    const result = Bun.spawnSync(command, {
      env: { ...process.env, MY_WORKSPACE: root },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    return {
      exitCode: result.exitCode,
      stdout: new TextDecoder().decode(result.stdout),
      stderr: new TextDecoder().decode(result.stderr),
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

for (const extension of [
  'ts',
  'tsx',
  'js',
  'jsx',
  'py',
  'go',
  'rs',
  'rb',
  'java',
  'kt',
  'php',
  'cs',
  'swift',
]) {
  test(
    [
      `given a shipped Report example naming src/server.${extension}`,
      'when the prompt contract checker runs',
      'it should fail with the source-path rule and the offending line',
    ].join(', '),
    () => {
      // given
      const prompt = withReport(
        `\`\`\`json\n{\n  "changed_files": ["src/server.${extension}"]\n}\n\`\`\``,
      )

      // when
      const actual = checkPrompt(prompt)

      // then
      expect(actual.exitCode).toBe(1)
      expect(actual.stdout).toContain(`${SHIPPED_PROMPT}:13`)
      expect(actual.stdout).toContain('[source-path-in-json]')
      expect(actual.stdout).toContain('violations=1')
      expect(actual.stderr).toBe('')
    },
  )
}

test(
  [
    'given source paths on separate lines in multiple JSON fences',
    'when the prompt contract checker runs',
    'it should report every offending line including evidence with a line number',
  ].join(', '),
  () => {
    // given
    const prompt = withReport(
      [
        '```json',
        '{ "changed_files": ["src/server.test.ts"] }',
        '```',
        '',
        '```json',
        '{ "evidence": "main.go:42 — handler registered" }',
        '```',
      ].join('\n'),
    )

    // when
    const actual = checkPrompt(prompt)

    // then
    expect(actual.exitCode).toBe(1)
    expect(actual.stdout).toContain(`${SHIPPED_PROMPT}:12`)
    expect(actual.stdout).toContain(`${SHIPPED_PROMPT}:16`)
    expect(actual.stdout).toContain('violations=2')
    expect(actual.stderr).toBe('')
  },
)

for (const { name, before, after } of [
  {
    name: 'repository-native examples in the provable-change instruction',
    before:
      '- **Make every change provable.** Each entry names the one command that settles it: `bun test`, `bun x tsc --noEmit`, a specific assertion.',
    after:
      "- **Make every change provable.** Each entry names the one command that settles it: this repository's own test command, its type checker, a specific assertion.",
  },
  {
    name: 'a wildcard example in the absolute-binary-path prohibition',
    before:
      "- You inherit the operator's shell environment. Call tools by bare name. Do not fall back to an absolute path such as `/usr/bin/git`.",
    after:
      "- You inherit the operator's shell environment. Call tools by bare name; never hunt for a binary or fall back to an absolute `/usr/bin/*` path.",
  },
]) {
  test(
    [
      `given ${name}`,
      'when the prompt is compared with its concrete examples',
      'it should preserve the instruction without requiring a specific toolchain',
    ].join(', '),
    () => {
      // given
      const baseline = withReport(`${before}\n\n\`\`\`json\n{}\n\`\`\``)
      const prompt = withReport(`${after}\n\n\`\`\`json\n{}\n\`\`\``)

      // when
      const actual = checkPrompt(prompt, { baseline })

      // then
      expect(actual.exitCode).toBe(0)
      expect(actual.stdout).toContain('checked=1 violations=0')
      expect(actual.stderr).toBe('')
    },
  )
}

for (const { name, before, after, rule } of [
  {
    name: 'an executable test command',
    before: 'Run `bun test`.\n\n```json\n{}\n```',
    after: "Run this repository's own test command.\n\n```json\n{}\n```",
    rule: 'dropped-literal',
  },
  {
    name: 'a source path the agent must read',
    before: 'Read `src/server.ts`.\n\n```json\n{}\n```',
    after: 'Read the necessary files.\n\n```json\n{}\n```',
    rule: 'dropped-literal',
  },
  {
    name: 'a source path alongside an unrelated glob example',
    before: 'Read `src/server.ts`.\n\n```json\n{}\n```',
    after: 'Do not report globs such as `src/**`.\n\n```json\n{}\n```',
    rule: 'dropped-literal',
  },
  {
    name: 'an absolute executable path outside the shell advice',
    before: 'Run `/usr/bin/git` status.\n\n```json\n{}\n```',
    after:
      'Never fall back to an absolute `/usr/bin/*` path.\n\n```json\n{}\n```',
    rule: 'dropped-literal',
  },
  {
    name: 'a Report field',
    before: '```json\n{ "changed_files": ["<a path you changed>"] }\n```',
    after: '```json\n{}\n```',
    rule: 'dropped-envelope-field',
  },
  {
    name: 'a harness input variable',
    before: '{{prompt}}\n\n```json\n{}\n```',
    after: '```json\n{}\n```',
    rule: 'dropped-variable',
  },
]) {
  test(
    [
      `given ${name}`,
      'when it is removed rather than generalized as an example',
      'it should still fail the existing contract rule',
    ].join(', '),
    () => {
      // given
      const baseline = withReport(before)
      const prompt = withReport(after)

      // when
      const actual = checkPrompt(prompt, { baseline })

      // then
      expect(actual.exitCode).toBe(1)
      expect(actual.stdout).toContain(`[${rule}]`)
      expect(actual.stdout).toContain('violations=1')
      expect(actual.stderr).toBe('')
    },
  )
}

for (const { name, example } of [
  {
    name: 'angle-bracket path and evidence placeholders',
    example:
      '```json\n{ "changed_files": ["<a path you changed>"], "evidence": "<path:line> — handler registered" }\n```',
  },
  {
    name: 'source paths used as prose analogies',
    example:
      'Add field `x` to `TSession` in `src/auth/session.ts`.\n\n```json\n{}\n```',
  },
  {
    name: 'source paths in a non-JSON fence',
    example: '```text\nsrc/server.ts\n```\n\n```json\n{}\n```',
  },
  {
    name: 'documentation and configuration paths',
    example:
      '```json\n{ "changed_files": ["README.md", "package.json", "config.yaml", "tsconfig.json"] }\n```',
  },
]) {
  test(
    [
      `given ${name}`,
      'when the prompt contract checker runs',
      'it should keep the compliant prompt clean',
    ].join(', '),
    () => {
      // given
      const prompt = withReport(example)

      // when
      const actual = checkPrompt(prompt)

      // then
      expect(actual.exitCode).toBe(0)
      expect(actual.stdout).toContain('checked=1 violations=0')
      expect(actual.stderr).toBe('')
    },
  )
}

for (const scope of ['all', 'given'] as const) {
  test(
    [
      `given the build Activity in the shell checker's ${scope} scope`,
      'when its Report example names a source file',
      'it should fail rather than prune the Activity as build output',
    ].join(', '),
    () => {
      // given
      const prompt = withReport(
        '```json\n{ "changed_files": ["src/server.ts"] }\n```',
      )

      // when
      const actual = checkPrompt(prompt, { scope })

      // then
      expect(actual.exitCode).toBe(1)
      expect(actual.stdout).toContain('[source-path-in-json]')
      expect(actual.stdout).toContain('checked=1 violations=1')
      expect(actual.stderr).toBe('')
    },
  )
}

for (const relativePath of [
  'templates/stamp/prompt-engineering/example/system.md',
  'templates/stamp/prompt-engineering/example/user.md',
  '.pi-crust/prompt-engineering/build/user.md',
]) {
  test(
    [
      `given a source-file example in ${relativePath}`,
      'when the prompt contract checker runs',
      'it should exempt scaffolds and repository-owned overrides',
    ].join(', '),
    () => {
      // given
      const prompt = withReport(
        '```json\n{ "changed_files": ["src/server.ts"] }\n```',
      )

      // when
      const actual = checkPrompt(prompt, { relativePath })

      // then
      expect(actual.exitCode).toBe(0)
      expect(actual.stdout).toContain('checked=1 violations=0')
      expect(actual.stderr).toBe('')
    },
  )
}
