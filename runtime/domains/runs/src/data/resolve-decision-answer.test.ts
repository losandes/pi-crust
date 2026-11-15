import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ANSWER_RECORD_FILENAME } from '../typedefs/decision-answer'
import { resolveDecisionAnswer } from './resolve-decision-answer'

for (const scenario of [
  { name: 'no answer', contents: undefined, directory: false, status: 'ok' },
  ...(['approve', 'answer', 'reject'] as const).map((verb) => ({
    name: verb,
    contents: JSON.stringify({
      verb,
      at: '2026-01-01T00:00:01.000Z',
      from: 'alice',
    }),
    directory: false,
    status: 'ok' as const,
  })),
  { name: 'malformed JSON', contents: '{', directory: false, status: 'error' },
  {
    name: 'an unknown verb',
    contents: JSON.stringify({
      verb: 'continue',
      at: '2026-01-01T00:00:01.000Z',
      from: 'alice',
    }),
    directory: false,
    status: 'error',
  },
  {
    name: 'an invalid timestamp',
    contents: JSON.stringify({
      verb: 'approve',
      at: 'not a date',
      from: 'alice',
    }),
    directory: false,
    status: 'error',
  },
  {
    name: 'an unreadable answer path',
    contents: undefined,
    directory: true,
    status: 'error',
  },
] as const) {
  test(
    [
      `given ${scenario.name} in the decision answer sidecar`,
      'when the data resolver reads it',
      'it should settle with a validated answer, absence, or an explicit read or parse failure',
    ].join(', '),
    () => {
      // given
      const dir = mkdtempSync(join(tmpdir(), 'crust-resolve-answer-'))
      const path = join(dir, ANSWER_RECORD_FILENAME)
      try {
        if (scenario.directory) mkdirSync(path)
        else if (scenario.contents !== undefined)
          writeFileSync(path, scenario.contents)

        // when
        const actual = resolveDecisionAnswer(dir)

        // then
        expect(actual.status).toBe(scenario.status)
        if (actual.status === 'error') {
          expect(actual.error).toBeInstanceOf(Error)
          expect(actual.error.message).not.toBe('')
        } else {
          expect(actual.data).toEqual(
            scenario.contents === undefined
              ? undefined
              : JSON.parse(scenario.contents),
          )
        }
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )
}
