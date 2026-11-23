import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/*
 * A run's handoff directory is gitignored and, in a linked worktree, sits in
 * the clone the worktree was created from. An agent whose own instructions
 * forbid reading gitignored files, or files outside its repository, stops and
 * asks for permission to read the plan it was handed (run 387bf521). The
 * prompt is the task-level instruction that grants it, so every prompt that
 * names the directory must keep saying so.
 */
const authorization =
  '`context_handoff_dir` and everything under it belong to this run: the ' +
  'handoff documents, envelopes and plans earlier Activities wrote for you. ' +
  'Read and write them as your own inputs and outputs. They are gitignored by ' +
  'design and may sit outside your working tree, in the clone the worktree ' +
  'was created from. Neither is a reason to ask permission, and neither makes ' +
  'them another repository.'

const root = join(import.meta.dir, '../..')
const paths = [
  ...new Bun.Glob('runtime/prompts/**/*.md').scanSync({ cwd: root }),
].filter((path) =>
  readFileSync(join(root, path), 'utf8').includes('{{context_handoff_dir}}'),
)

test(
  [
    'given the shipped prompts',
    'when selecting those that name context_handoff_dir',
    'it should find the writer, reviser and judge prompts',
  ].join(', '),
  () => {
    // given
    // when
    const actual = paths
    // then
    expect(actual).toContain('runtime/prompts/build/user.md')
    expect(actual).toContain('runtime/prompts/build/revise.md')
    expect(actual).toContain('runtime/prompts/code-review/user.md')
  },
)

for (const path of paths) {
  test(
    [
      `given the shipped prompt ${path}`,
      'when it names context_handoff_dir',
      'it should authorize reading and writing that directory',
    ].join(', '),
    () => {
      // given
      const text = readFileSync(join(root, path), 'utf8')
      // when
      const actual = text.includes(authorization)
      // then
      expect(actual).toBe(true)
    },
  )
}
