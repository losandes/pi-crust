import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SKIP_INTEGRATION } from './testing/integration'
import { tokenRepo } from './testing/token-repo'

for (const one of [
  { mode: 'ask', name: 'token configuration', options: {} },
  { mode: 'amend', name: 'token configuration', options: {} },
  {
    mode: 'ask',
    name: 'a data directory separate from the store',
    options: { separateData: true },
  },
]) {
  test.skipIf(SKIP_INTEGRATION)(
    [
      `given ${one.mode} with ${one.name}`,
      'when consulting a completed activity',
      'it should find its recorded session and append a consult event under the data directory',
    ].join(', '),
    () => {
      // given
      using fixture = tokenRepo(one.options)

      // when
      const child = fixture.invoke('consult.ts', [
        one.mode,
        fixture.runId,
        'build',
        'explain your decision',
      ])
      const output = child.stdout.toString()

      // then
      expect(child.exitCode).toBe(0)
      expect(output).toContain('fixture agent answer')
      expect(output).not.toContain('no activity')
      expect(output).not.toContain('no recorded session')
      expect(
        readFileSync(join(fixture.sessionDir, 'events.jsonl'), 'utf8'),
      ).toContain('"type":"consult"')
    },
  )
}
