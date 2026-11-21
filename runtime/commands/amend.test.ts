import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SKIP_INTEGRATION } from '../testing/integration'
import { tokenRepo } from '../testing/token-repo'
import { main } from './amend'

for (const one of [
  { mode: 'ask', name: 'token configuration', options: {} },
  { mode: 'amend', name: 'token configuration', options: {} },
  {
    mode: 'ask',
    name: 'a data directory separate from the store',
    options: { separateData: true },
  },
].filter((one) => one.mode === 'amend')) {
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
      const child = fixture.invoke('amend.ts', [
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

test(
  [
    'given amend without arguments',
    'when calling its entry function',
    'it should return usage without opening a run',
  ].join(', '),
  async () => {
    // given
    const argv: readonly string[] = []
    // when
    const actual = await main(argv)
    // then
    expect(actual).toBe(2)
  },
)
