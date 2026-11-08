import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  TActivityRun,
  TActivityRunStatus,
  TTracer,
} from '../../../../lib/contracts'
import { activityRunParams } from '../../../../lib/contracts'
import { appendSteering, readSteering } from '../../../agents'
import { activityRunsToCarry, writeHandoffPointer } from '../../../handoff'
import { createTracer, readRunState } from '../../../trace'
import { seedBranch } from './branch-seed'

const scratch = (): string => mkdtempSync(join(tmpdir(), 'crust-branch-seed-'))

const activityRunRecord = (
  runId: string,
  seq: number,
  name: string,
  status: TActivityRunStatus,
): TActivityRun => ({
  activity_run_id: `${runId}_${String(seq).padStart(2, '0')}_${name}`,
  run_id: runId,
  seq,
  params: activityRunParams({
    name,
    kind: 'agent',
    owner: name,
    description: `Do the ${name} work`,
  }),
  status,
  error: undefined,
  started_at: '2024-01-01T00:00:00.000Z',
  ended_at: '2024-01-01T00:00:01.000Z',
})

/** A source run with four activities, the last two reachable by `activityRunsToCarry`. */
const buildSourceRun = (
  dataDir: string,
  runId: string,
): Readonly<{
  dbPath: string
  carry: readonly string[]
  sessionDir: string
}> => {
  const dbPath = join(dataDir, 'crust.db')
  const tracer: TTracer = createTracer(
    dbPath,
    join(dataDir, 'sessions', runId, 'events.jsonl'),
  )
  tracer.sessionStart(runId, 'tester', 'sdlc')
  tracer.sessionWorkspace(runId, '/repo', 'main')
  const activities: ReadonlyArray<
    readonly [number, string, TActivityRunStatus]
  > = [
    [1, 'scout', 'success'],
    [2, 'conceptualize', 'success'],
    [3, 'design', 'success'],
    [4, 'plan', 'success'],
  ]
  for (const [seq, name, status] of activities) {
    const record = activityRunRecord(runId, seq, name, status)
    tracer.activityRunUpsert(record)
    tracer.event({
      run_id: runId,
      activity_run_id: record.activity_run_id,
      type: 'narration',
      name: `${name} text`,
      payload: { turn: 1, channel: 'text', text: `thinking about ${name}` },
    })
    tracer.envelopeRow(
      record,
      name,
      'TEnvelope',
      JSON.stringify({ summary: name }),
      true,
    )
    tracer.gateRow(record, 'plan-gate', { checks: [], notes: '' } as never)
  }
  tracer.agentSessionRow(
    runId,
    {
      name: 'scout',
      coding_agent: 'claude',
      model: 'opus',
      color: 'blue',
    } as never,
    'sess_1',
    100,
    200,
  )
  tracer.close()

  const sessionDir = join(dataDir, 'sessions', runId)
  mkdirSync(join(sessionDir, 'scout', 'pi_sessions'), { recursive: true })
  writeFileSync(
    join(sessionDir, 'scout', 'envelope.json'),
    '{"summary":"scout"}\n',
  )
  writeFileSync(join(sessionDir, 'scout', 'pi_sessions', 'sess_1.json'), '{}\n')
  writeFileSync(
    join(sessionDir, 'agent_map.json'),
    '{"scout":{"session_id":"sess_1"}}\n',
  )
  writeFileSync(join(sessionDir, 'events.jsonl'), 'should not be carried\n')
  writeFileSync(join(sessionDir, 'resume.log'), 'should not be carried\n')
  writeFileSync(
    join(sessionDir, 'invocation.json'),
    `${JSON.stringify({
      argv: [
        'bun',
        'runtime/cli.ts',
        '--handoff',
        '/somewhere/else',
        '--run-id',
        runId,
      ],
      cwd: '/repo',
    })}\n`,
  )

  const handoffDir = join(sessionDir, 'context_handoff')
  mkdirSync(handoffDir, { recursive: true })
  writeHandoffPointer(sessionDir, handoffDir)
  writeFileSync(join(handoffDir, 'scout.md'), '# scout output\n')
  appendSteering(handoffDir, 'an earlier instruction\n')

  const state = readRunState(dbPath, runId)
  const carry =
    state === undefined
      ? []
      : activityRunsToCarry(state.activityRuns, 'design').map(
          (activityRun) => activityRun.activity_run_id,
        )
  return { dbPath, carry, sessionDir }
}

test(
  [
    'given data/branch-seed::seedBranch',
    'when a branch is seeded for an activity in the middle of the chain',
    'it should carry exactly the standing activities before it, skippable on resume',
  ].join(', '),
  () => {
    // given
    const dataDir = scratch()
    const { dbPath, carry } = buildSourceRun(dataDir, 'src00001')

    // when
    seedBranch({
      dbPath,
      dataDir,
      sourceRunId: 'src00001',
      branchRunId: 'brn00001',
      carry,
      seeding: 'fork',
      at: '2026-01-01T00:00:00.000Z',
    })

    // then — the branch reads as having completed exactly the carried names
    const state = readRunState(dbPath, 'brn00001')
    expect(state?.completed.toSorted()).toEqual(
      ['scout', 'conceptualize'].toSorted(),
    )
    expect(state?.resumable).toBe(true)
  },
)

test(
  [
    'given data/branch-seed::seedBranch',
    'when a branch is seeded',
    'it should leave the source run byte-for-byte untouched',
  ].join(', '),
  () => {
    // given
    const dataDir = scratch()
    const { dbPath, carry, sessionDir } = buildSourceRun(dataDir, 'src00002')
    const before = readRunState(dbPath, 'src00002')
    const steeringBefore = readSteering(join(sessionDir, 'context_handoff'))

    // when
    seedBranch({
      dbPath,
      dataDir,
      sourceRunId: 'src00002',
      branchRunId: 'brn00002',
      carry,
      seeding: 'fork',
      at: '2026-01-01T00:00:00.000Z',
    })

    // then
    const after = readRunState(dbPath, 'src00002')
    expect(after?.activityRuns.map((a) => a.status)).toEqual(
      before?.activityRuns.map((a) => a.status),
    )
    expect(readSteering(join(sessionDir, 'context_handoff'))).toBe(
      steeringBefore,
    )
  },
)

test(
  [
    'given data/branch-seed::seedBranch',
    'when events belong to a carried activity run',
    'it should copy them under the branch run id, with different event ids',
  ].join(', '),
  () => {
    // given
    const dataDir = scratch()
    const { dbPath, carry } = buildSourceRun(dataDir, 'src00003')

    // when
    seedBranch({
      dbPath,
      dataDir,
      sourceRunId: 'src00003',
      branchRunId: 'brn00003',
      carry,
      seeding: 'fork',
      at: '2026-01-01T00:00:00.000Z',
    })

    // then
    const db = new Database(dbPath, { readonly: true })
    const sourceEvents = db
      .query<{ event_id: string }, [string]>(
        'SELECT event_id FROM events WHERE run_id=?',
      )
      .all('src00003')
    const branchEvents = db
      .query<{ event_id: string }, [string]>(
        'SELECT event_id FROM events WHERE run_id=?',
      )
      .all('brn00003')
    db.close()
    expect(sourceEvents.length).toBeGreaterThan(0)
    expect(branchEvents.length).toBe(2) // scout + conceptualize narration events
    const sourceIds = new Set(sourceEvents.map((e) => e.event_id))
    for (const row of branchEvents) {
      expect(sourceIds.has(row.event_id)).toBe(false)
    }
  },
)

test(
  [
    'given data/branch-seed::seedBranch',
    'when seeding is "fork"',
    'it should carry agent_map.json and pi_sessions/, and envelope.json either way',
  ].join(', '),
  () => {
    // given
    const dataDir = scratch()
    const { dbPath, carry } = buildSourceRun(dataDir, 'src00004')

    // when
    const seeded = seedBranch({
      dbPath,
      dataDir,
      sourceRunId: 'src00004',
      branchRunId: 'brn00004',
      carry,
      seeding: 'fork',
      at: '2026-01-01T00:00:00.000Z',
    })

    // then
    expect(existsSync(join(seeded.sessionDir, 'agent_map.json'))).toBe(true)
    expect(
      existsSync(
        join(seeded.sessionDir, 'scout', 'pi_sessions', 'sess_1.json'),
      ),
    ).toBe(true)
    expect(existsSync(join(seeded.sessionDir, 'scout', 'envelope.json'))).toBe(
      true,
    )
  },
)

test(
  [
    'given data/branch-seed::seedBranch',
    'when seeding is "fresh"',
    'it should drop agent_map.json and pi_sessions/, but keep envelope.json',
  ].join(', '),
  () => {
    // given
    const dataDir = scratch()
    const { dbPath, carry } = buildSourceRun(dataDir, 'src00005')

    // when
    const seeded = seedBranch({
      dbPath,
      dataDir,
      sourceRunId: 'src00005',
      branchRunId: 'brn00005',
      carry,
      seeding: 'fresh',
      at: '2026-01-01T00:00:00.000Z',
    })

    // then
    expect(existsSync(join(seeded.sessionDir, 'agent_map.json'))).toBe(false)
    expect(existsSync(join(seeded.sessionDir, 'scout', 'pi_sessions'))).toBe(
      false,
    )
    expect(existsSync(join(seeded.sessionDir, 'scout', 'envelope.json'))).toBe(
      true,
    )
  },
)

test(
  [
    'given data/branch-seed::seedBranch',
    'when the branch is seeded',
    'it should rewrite invocation.json to drop --handoff and its value',
  ].join(', '),
  () => {
    // given
    const dataDir = scratch()
    const { dbPath, carry } = buildSourceRun(dataDir, 'src00006')

    // when
    const seeded = seedBranch({
      dbPath,
      dataDir,
      sourceRunId: 'src00006',
      branchRunId: 'brn00006',
      carry,
      seeding: 'fork',
      at: '2026-01-01T00:00:00.000Z',
    })

    // then
    const invocation = JSON.parse(
      readFileSync(join(seeded.sessionDir, 'invocation.json'), 'utf8'),
    ) as { argv: readonly string[]; cwd: string }
    expect(invocation.argv).not.toContain('--handoff')
    expect(invocation.argv).not.toContain('/somewhere/else')
    expect(invocation.cwd).toBe('/repo')
  },
)

test(
  [
    'given data/branch-seed::seedBranch',
    'when the branch is seeded',
    "it should start the branch's sessions row with zero tokens and cost",
  ].join(', '),
  () => {
    // given
    const dataDir = scratch()
    const { dbPath, carry } = buildSourceRun(dataDir, 'src00007')
    const db = new Database(dbPath)
    db.run(
      'UPDATE sessions SET total_tokens=12345, total_cost=6.78 WHERE run_id=?',
      ['src00007'],
    )
    db.close()

    // when
    seedBranch({
      dbPath,
      dataDir,
      sourceRunId: 'src00007',
      branchRunId: 'brn00007',
      carry,
      seeding: 'fork',
      at: '2026-01-01T00:00:00.000Z',
    })

    // then
    const readback = new Database(dbPath, { readonly: true })
    const row = readback
      .query<{ total_tokens: number; total_cost: number }, [string]>(
        'SELECT total_tokens, total_cost FROM sessions WHERE run_id=?',
      )
      .get('brn00007')
    readback.close()
    expect(row).toEqual({ total_tokens: 0, total_cost: 0 })
  },
)
