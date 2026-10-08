import { expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeText } from '../data/files'
import { buildOutput } from '../typedefs/envelope'
import type { TRun } from '../typedefs/run'
import { readEnvelope } from './read-envelope'

const scratch = (): string => mkdtempSync(join(tmpdir(), 'crust-envelope-'))

/** Only the two fields `readEnvelope` reaches for. */
const runIn = (sessionDir: string): TRun =>
  ({ sessionDir, runId: 'aaaa1111' }) as unknown as TRun

test(
  [
    'given use-cases/read-envelope::readEnvelope',
    'when the persisted envelope carries the writer-added metadata keys',
    'it should strip them and parse the rest against the spec',
  ].join(', '),
  () => {
    // given
    const dir = scratch()
    writeText(
      join(dir, 'builder', 'envelope.json'),
      JSON.stringify({
        agent_name: 'builder',
        purpose: 'implement',
        output_type: 'BuildOutput',
        attempt: 2,
        status: 'success',
        summary: 'built it',
        changed_files: ['src/a.ts'],
        commit_message: 'Add a',
        artifacts: [],
        notes_for_next_agent: '',
        facts: [],
        decisions: [],
        assumptions: [],
        unresolved: [],
        risks: [],
        objective_met: { met: true, evidence: 'bun test exit 0' },
        regress_to: { stage: '', because: '' },
      }),
    )

    // when
    const actual = readEnvelope(runIn(dir), 'builder', buildOutput)

    // then
    expect(actual.status).toEqual('ok')
    expect(actual.status === 'ok' ? actual.data.changed_files : []).toEqual([
      'src/a.ts',
    ])
  },
)

test(
  [
    'given use-cases/read-envelope::readEnvelope',
    'when no envelope was ever written for that agent',
    'it should settle with an error naming the exact path',
  ].join(', '),
  () => {
    // given
    const dir = scratch()

    // when
    const actual = readEnvelope(runIn(dir), 'builder', buildOutput)

    // then
    expect(actual.status).toEqual('error')
    expect(actual.status === 'error' ? actual.error.message : '').toContain(
      join(dir, 'builder', 'envelope.json'),
    )
  },
)
