import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const supplied = [
  'prompt',
  'previous_envelope',
  'previous_envelopes',
  'context_handoff_dir',
  'output_document',
  'annotating_handoffs',
  'changed_files',
  'change_base',
  'step_catalogue',
  'trust_stance',
]
const root = join(import.meta.dir, '../..')
const paths = [
  ...new Bun.Glob('runtime/prompts/**/*.md').scanSync({ cwd: root }),
  ...new Bun.Glob('templates/stamp/prompts/**/*.md').scanSync({ cwd: root }),
]

test(
  [
    'given both shipped prompt directories',
    'when discovering Markdown prompts',
    'it should include the runtime prompts and the stamp scaffold',
  ].join(', '),
  () => {
    // given
    // when
    const actual = paths
    // then
    expect(actual).toContain('runtime/prompts/build/user.md')
    expect(actual).toContain('templates/stamp/prompts/example/system.md')
  },
)

for (const path of paths) {
  test(
    [
      `given the shipped prompt ${path}`,
      'when collecting its template variables',
      'it should use only names executeAgent supplies',
    ].join(', '),
    () => {
      // given
      const text = readFileSync(join(root, path), 'utf8')
      // when
      const names = [...text.matchAll(/\{\{([^{}]+)\}\}/g)].map(
        (match) => match[1],
      )
      // then
      expect(names.filter((name) => !supplied.includes(name ?? ''))).toEqual([])
    },
  )
}
