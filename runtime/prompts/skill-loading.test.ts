import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const skillLoading = /\b(?:load|loading|read)\b[^\n]*\bskills?\b/i
const paths = [...new Bun.Glob('**/*.md').scanSync({ cwd: import.meta.dir })]

for (const instruction of [
  'Load every skill of this repository that governs the files you are about to change.',
  'Load any skill that governs the kind of artifact you are about to produce.',
  'Judge the change by loading and following the repository review skill.',
  'Do not load a skill that governs work you are not going to do.',
]) {
  test(
    [
      `given the loading policy: ${instruction}`,
      'when checking for skill-loading instructions',
      'it should detect the policy',
    ].join(', '),
    () => {
      // given
      const text = instruction
      // when
      const actual = skillLoading.test(text)
      // then
      expect(actual).toBe(true)
    },
  )
}

test(
  [
    'given the shipped prompt directory',
    'when discovering its Markdown files',
    'it should include the builder, reviewer and analyst prompts',
  ].join(', '),
  () => {
    // given
    // when
    const actual = paths
    // then
    expect(actual).toContain('build/system.md')
    expect(actual).toContain('code-review/system.md')
    expect(actual).toContain('identify/system.md')
  },
)

for (const path of paths) {
  test(
    [
      `given the shipped prompt ${path}`,
      'when checking its instructions',
      'it should leave skill loading to the harness and repository instructions',
    ].join(', '),
    () => {
      // given
      const text = readFileSync(join(import.meta.dir, path), 'utf8')
      // when
      const actual = text.split('\n').filter((line) => skillLoading.test(line))
      // then
      expect(actual).toEqual([])
    },
  )
}

test(
  [
    'given the code-review prompts',
    'when reviewing their responsibilities',
    'it should retain convention-based review without requiring a loaded skill',
  ].join(', '),
  () => {
    // given
    const system = readFileSync(
      join(import.meta.dir, 'code-review/system.md'),
      'utf8',
    )
    const user = readFileSync(
      join(import.meta.dir, 'code-review/user.md'),
      'utf8',
    )
    // when
    const requiresSkill =
      system.includes('no conventions were found') ||
      user.includes('the skill names')
    // then
    expect(system).toContain(
      "Judge the change against this repository's ratified conventions.",
    )
    expect(system).toContain(
      'Every finding names a convention and a `file:line`.',
    )
    expect(requiresSkill).toBe(false)
  },
)
