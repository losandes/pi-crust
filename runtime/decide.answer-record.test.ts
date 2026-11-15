import { expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { main } from './decide'
import { gateFixture } from './domains/runs/src/use-cases/human-gate-fixture.test'
import { EXIT } from './lib/contracts'

for (const verb of ['approve', 'answer', 'reject'] as const) {
  test(
    [
      `given a waiting run and CLI decision ${verb}`,
      'when the decision is recorded without an invocation to resume',
      'it should write machine-readable attribution alongside the prose answer',
    ].join(', '),
    async () => {
      // given
      using fixture = gateFixture()
      const { run } = fixture
      run.tracer.sessionWaiting(run.runId)
      const config = fixture.configPath()
      const file = join(fixture.dir, 'operator-answer.md')
      writeFileSync(file, 'Accept these findings')
      const before = Date.now()

      // when
      const actual = await main([
        verb,
        run.runId,
        '--config',
        config,
        '--db',
        run.tracer.dbPath,
        '--note',
        'Do not deliver',
        '--file',
        file,
      ])
      const record = JSON.parse(
        readFileSync(
          join(run.contextHandoffDir, 'decision-answer.json'),
          'utf8',
        ),
      )

      // then
      expect(actual).toBe(EXIT.SUCCESS)
      expect(record).toEqual({
        verb,
        at: expect.any(String),
        from: expect.any(String),
      })
      expect(record.from.length).toBeGreaterThan(0)
      expect(Date.parse(record.at)).toBeGreaterThanOrEqual(before)
      expect(Date.parse(record.at)).toBeLessThanOrEqual(Date.now())
      expect(
        readFileSync(
          join(run.contextHandoffDir, 'decision-answer.md'),
          'utf8',
        ).trim(),
      ).not.toBe('')
    },
  )
}
