import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { recordDecision } from './writes'

for (const verb of ['approve', 'answer', 'reject'] as const) {
  test(
    [
      `given the web decision writer with ${verb}`,
      'when a person answers a gate',
      'it should record the verb, timestamp and author beside the unchanged prose answer',
    ].join(', '),
    () => {
      // given
      const root = mkdtempSync(join(tmpdir(), 'crust-web-decision-'))
      const before = Date.now()
      try {
        // when
        const path = recordDecision(
          join(root, 'crust.db'),
          'answer119',
          verb,
          'Operator note',
          'alice',
        )
        const record = JSON.parse(
          readFileSync(join(dirname(path), 'decision-answer.json'), 'utf8'),
        )

        // then
        expect(record).toEqual({ verb, at: expect.any(String), from: 'alice' })
        expect(Date.parse(record.at)).toBeGreaterThanOrEqual(before)
        expect(Date.parse(record.at)).toBeLessThanOrEqual(Date.now())
        expect(readFileSync(path, 'utf8')).toContain('Operator note')
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
  )
}
