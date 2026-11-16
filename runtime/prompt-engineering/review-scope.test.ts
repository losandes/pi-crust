import { expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = import.meta.dir
const judges = readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(root, entry.name))
  .filter(
    (directory) =>
      existsSync(join(directory, 'user.md')) &&
      readFileSync(join(directory, 'user.md'), 'utf8').includes('ReviewOutput'),
  )

for (const directory of judges) {
  test(
    [
      `given the judging prompts in ${directory.split('/').at(-1)}`,
      'when their scope instructions are read',
      'it should never name the previous envelopes claimed files as scope',
    ].join(', '),
    () => {
      // given
      const files = ['system.md', 'user.md'].map((name) =>
        join(directory, name),
      )
      // when
      const texts = files.map((path) => readFileSync(path, 'utf8'))
      // then
      for (const text of texts)
        expect(text).not.toContain('previous_envelope.changed_files')
    },
  )
}

for (const name of ['code-review', 'outcome-review']) {
  test(
    [
      `given ${name} user instructions`,
      'when reading the scope contract',
      'it should present the single file list and where to read its difference',
    ].join(', '),
    () => {
      // given
      const path = join(root, name, 'user.md')
      // when
      const text = readFileSync(path, 'utf8')
      // then
      expect(text).toContain('{{changed_files}}')
      expect(text).toContain('{{change_base}}')
      expect(text).toContain('git diff <change_base>')
    },
  )
}
