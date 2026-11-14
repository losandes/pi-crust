import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { buildOutput, buildOutputSchema } from '../../../../lib/contracts'
import { readHistoryEnvelope } from './read-envelope'

const CONTEXT = {
  status: 'success',
  summary: '',
  artifacts: [],
  notes_for_next_agent: '',
  facts: [],
  decisions: [],
  assumptions: [],
  unresolved: [],
  risks: [],
  objective_met: { met: true, evidence: 'fixture' },
  regress_to: { activity: '', because: '' },
}

const work = (summary: string) =>
  buildOutputSchema.parse({
    ...CONTEXT,
    summary,
    changed_files: ['src/work.ts'],
  })

const fixture = () => {
  const sessionDir = mkdtempSync(join(tmpdir(), 'crust-history-replay-'))
  return {
    sessionDir,
    [Symbol.dispose]: () =>
      rmSync(sessionDir, { recursive: true, force: true }),
  }
}

const plant = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

test(
  [
    'given issue #108 requirement 1.3.3 and a writer and reviser sharing one agent',
    'when the writer has its own persisted history envelope',
    'it should replay that work rather than the agents newer revision',
  ].join(', '),
  () => {
    // given
    using run = fixture()
    const original = work('original builder output')
    plant(
      join(run.sessionDir, 'envelope-history', 'build', 'envelope.json'),
      JSON.stringify({
        agent_name: 'build',
        output_type: 'BuildOutput',
        purpose: 'original work',
        ...original,
      }),
    )
    plant(
      join(run.sessionDir, 'build', 'envelope.json'),
      JSON.stringify(work('newer revision')),
    )

    // when
    const actual = readHistoryEnvelope(run, 'build', 'build', buildOutput)

    // then
    expect(actual.status).toBe('ok')
    expect(actual.status === 'ok' ? actual.data : undefined).toEqual(original)
  },
)

for (const broken of [
  { name: 'invalid JSON', content: '{not JSON' },
  { name: 'a contract-invalid payload', content: JSON.stringify(CONTEXT) },
]) {
  test(
    [
      'given issue #108 requirement 1.3.3 and an intact legacy agent envelope',
      `when the participants history envelope contains ${broken.name}`,
      'it should report the corrupt participant instead of silently substituting a different output from the same agent',
    ].join(', '),
    () => {
      // given
      using run = fixture()
      plant(
        join(run.sessionDir, 'build', 'envelope.json'),
        JSON.stringify(work('unrelated latest output')),
      )
      plant(
        join(run.sessionDir, 'envelope-history', 'revise', 'envelope.json'),
        broken.content,
      )

      // when
      const actual = readHistoryEnvelope(run, 'revise', 'build', buildOutput)

      // then
      expect(actual.status).toBe('error')
      expect(
        actual.status === 'error' ? actual.error : undefined,
      ).toBeInstanceOf(Error)
    },
  )
}

test(
  [
    'given issue #108 requirement 1.3.3 and a session written before participant snapshots existed',
    'when only the per-agent envelope is persisted',
    'it should preserve the legacy replay path and return its complete envelope',
  ].join(', '),
  () => {
    // given
    using run = fixture()
    const legacy = work('latest output from the legacy session')
    plant(
      join(run.sessionDir, 'build', 'envelope.json'),
      JSON.stringify(legacy),
    )

    // when
    const actual = readHistoryEnvelope(run, 'revise', 'build', buildOutput)

    // then
    expect(actual.status).toBe('ok')
    expect(actual.status === 'ok' ? actual.data : undefined).toEqual(legacy)
  },
)
