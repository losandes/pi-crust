import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTracer } from '../data/trace-db'
import { restoreTerminal, silenceTerminal } from '../testing/terminal-capture'
import { activityRunParams } from '../typedefs/activity-run'
import { crustConfigSchema } from '../typedefs/config'
import type { TRun } from '../typedefs/run'
import { EXIT } from '../typedefs/run-state'
import { createRun } from './create-run'
import {
  counts,
  finish,
  finishWaiting,
  runActivityRun,
} from './run-activity-run'

beforeEach(silenceTerminal)
afterEach(restoreTerminal)

const scratchRun = (): Readonly<{ run: TRun; dbPath: string }> => {
  const dir = mkdtempSync(join(tmpdir(), 'crust-run-activityRun-test-'))
  const dbPath = join(dir, 'crust.db')
  const cfg = crustConfigSchema.parse({
    defaults: { data_dir: join(dir, 'data') },
    observability: { db: dbPath },
    agents: [],
  })
  const tracer = createTracer(
    dbPath,
    join(dir, 'data', 'sessions', 'test0001', 'events.jsonl'),
  )
  tracer.sessionStart('test0001', 'tester', 'quality')
  return {
    run: createRun({ cfg, runId: 'test0001', tracer, engineer: 'tester' }),
    dbPath,
  }
}

const rowsOf = <TRow>(dbPath: string, sql: string): readonly TRow[] => {
  const db = new Database(dbPath, { readonly: true })
  const rows = db.query<TRow, []>(sql).all()
  db.close()
  return rows
}

test(
  [
    'given use-cases/run-activity-run::runActivityRun',
    'when an activity run body completes cleanly',
    'it should record success and return the body result',
  ].join(', '),
  async () => {
    // given
    const { run, dbPath } = scratchRun()
    const activityRun = runActivityRun(run)

    // when
    const actual = await activityRun(
      activityRunParams({
        name: 'request',
        kind: 'engineer',
        owner: 'tester',
        description: 'Capture the incoming ask',
      }),
      (ph) => {
        ph.log({ input: 'verify the port' })
        return 'done'
      },
    )

    // then
    expect(actual).toEqual('done')
    expect(
      rowsOf<{ name: string; status: string; description: string }>(
        dbPath,
        'SELECT name, status, description FROM activity_runs',
      ),
    ).toEqual([
      {
        name: 'request',
        status: 'success',
        description: 'Capture the incoming ask',
      },
    ])
    run.tracer.close()
  },
)

test(
  [
    'given use-cases/run-activity-run::runActivityRun',
    'when an activity run body throws',
    'it should record the failure, finalize the session, and rethrow',
  ].join(', '),
  async () => {
    // given
    const { run, dbPath } = scratchRun()
    const activityRun = runActivityRun(run)
    await activityRun(
      activityRunParams({
        name: 'request',
        kind: 'engineer',
        owner: 'tester',
        description: 'Capture the incoming ask',
      }),
      () => undefined,
    )

    // when
    const thrown = await activityRun(
      activityRunParams({
        name: 'quality',
        kind: 'code',
        owner: 'quality',
        description: 'Run the deterministic quality blocks',
      }),
      () => {
        throw new Error('quality failed: lint exited 1')
      },
    ).then(
      () => undefined,
      (error: unknown) => error,
    )

    // then
    expect((thrown as Error).message).toEqual('quality failed: lint exited 1')
    expect(
      rowsOf<{ name: string; status: string }>(
        dbPath,
        'SELECT name, status FROM activity_runs ORDER BY seq',
      ),
    ).toEqual([
      { name: 'request', status: 'success' },
      { name: 'quality', status: 'fail' },
    ])
    expect(
      rowsOf<{ status: string }>(dbPath, 'SELECT status FROM sessions'),
    ).toEqual([{ status: 'fail' }])
    expect(
      rowsOf<{ type: string }>(
        dbPath,
        "SELECT type FROM events WHERE type IN ('error','activity_run_end') ORDER BY rowid",
      ).map((row) => row.type),
    ).toEqual(['activity_run_end', 'error', 'activity_run_end'])
    run.tracer.close()
  },
)

test(
  [
    'given use-cases/run-activity-run::finish',
    'when every activity run passed but the run was not accepted',
    'it should exit 1, record not_accepted, and mark the session failed',
  ].join(', '),
  async () => {
    // given
    const { run, dbPath } = scratchRun()
    const activityRun = runActivityRun(run)
    await activityRun(
      activityRunParams({
        name: 'test_1',
        kind: 'code',
        owner: 'quality',
        description: 'Run the suite and report what it said',
      }),
      () => undefined,
    )

    // when
    const actual = finish(run, {
      accepted: false,
      reason: 'the suite still failed after 3 fix attempt(s)',
    })

    // then
    expect(actual).toEqual(1)
    expect(
      rowsOf<{ status: string }>(dbPath, 'SELECT status FROM sessions'),
    ).toEqual([{ status: 'fail' }])
    expect(
      rowsOf<{ name: string }>(
        dbPath,
        "SELECT name FROM events WHERE type='error'",
      ),
    ).toEqual([{ name: 'not_accepted' }])
    run.tracer.close()
  },
)

test(
  [
    'given use-cases/run-activity-run::finish',
    'when every activity run passed and the run was accepted',
    'it should exit 0 and mark the session successful',
  ].join(', '),
  async () => {
    // given
    const { run, dbPath } = scratchRun()
    const activityRun = runActivityRun(run)
    await activityRun(
      activityRunParams({
        name: 'test_1',
        kind: 'code',
        owner: 'quality',
        description: 'Run the suite and report what it said',
      }),
      () => undefined,
    )

    // when
    const actual = finish(run)

    // then
    expect(actual).toEqual(0)
    expect(
      rowsOf<{ status: string }>(dbPath, 'SELECT status FROM sessions'),
    ).toEqual([{ status: 'success' }])
    run.tracer.close()
  },
)

test(
  [
    'given use-cases/run-activity-run::finish',
    'when the run opened no activityRuns at all',
    'it should refuse to call that a success',
  ].join(', '),
  () => {
    // given
    const { run } = scratchRun()

    // when
    const actual = finish(run)

    // then
    expect(actual).toEqual(1)
    run.tracer.close()
  },
)

test(
  [
    'given use-cases/run-activity-run::counts',
    'when an activity run was superseded by a later retry of the same activity',
    'it should not count towards the run, and a successful retry alone should finish the run successful (1.5.1)',
  ].join(', '),
  async () => {
    // given \u2014 a gate retry: the first attempt is superseded, the second succeeds
    const { run, dbPath } = scratchRun()
    const activityRun = runActivityRun(run)
    await activityRun(
      activityRunParams({
        name: 'build',
        kind: 'agent',
        owner: 'builder',
        description: 'Implement the design',
      }),
      () => 'first attempt',
    )
    const firstRow = run
      .activityRuns()
      .find((candidate) => candidate.params.name === 'build')
    if (firstRow !== undefined) {
      run.tracer.activityRunUpsert(
        run.updateActivityRun(firstRow.activity_run_id, {
          status: 'superseded',
        }),
      )
    }
    await activityRun(
      activityRunParams({
        name: 'build',
        kind: 'agent',
        owner: 'builder',
        description: 'Implement the design',
      }),
      () => 'retry',
    )

    // when
    const actual = finish(run)

    // then
    expect(actual).toEqual(0)
    expect(
      rowsOf<{ status: string }>(dbPath, 'SELECT status FROM sessions'),
    ).toEqual([{ status: 'success' }])
    run.tracer.close()
  },
)

test(
  [
    'given use-cases/run-activity-run::finish',
    'when an activity run holds status fail',
    'it should report fail and name that activity run and its status in an error event (1.5.2)',
  ].join(', '),
  async () => {
    // given
    const { run, dbPath } = scratchRun()
    const activityRun = runActivityRun(run)
    await activityRun(
      activityRunParams({
        name: 'build',
        kind: 'agent',
        owner: 'builder',
        description: 'Implement the design',
      }),
      () => 'ok',
    )
    const row = run
      .activityRuns()
      .find((candidate) => candidate.params.name === 'build')
    if (row !== undefined) {
      run.tracer.activityRunUpsert(
        run.updateActivityRun(row.activity_run_id, { status: 'fail' }),
      )
    }

    // when
    const actual = finish(run)

    // then
    expect(actual).toEqual(1)
    expect(
      rowsOf<{ status: string }>(dbPath, 'SELECT status FROM sessions'),
    ).toEqual([{ status: 'fail' }])
    const events = rowsOf<{ name: string; payload_json: string }>(
      dbPath,
      "SELECT name, payload_json FROM events WHERE type='error'",
    )
    expect(events.map((event) => event.name)).toContain('activity_runs_failed')
    const failedEvent = events.find(
      (event) => event.name === 'activity_runs_failed',
    )
    expect(JSON.parse(failedEvent?.payload_json ?? '{}').activityRuns).toEqual([
      { activity_run_id: row?.activity_run_id, status: 'fail' },
    ])
    run.tracer.close()
  },
)

test(
  [
    'given use-cases/run-activity-run::finish',
    'when every activity run recorded for the run is superseded',
    'it should not report success (1.5.3)',
  ].join(', '),
  async () => {
    // given
    const { run, dbPath } = scratchRun()
    const activityRun = runActivityRun(run)
    await activityRun(
      activityRunParams({
        name: 'build',
        kind: 'agent',
        owner: 'builder',
        description: 'Implement the design',
      }),
      () => 'ok',
    )
    const row = run
      .activityRuns()
      .find((candidate) => candidate.params.name === 'build')
    if (row !== undefined) {
      run.tracer.activityRunUpsert(
        run.updateActivityRun(row.activity_run_id, { status: 'superseded' }),
      )
    }

    // when
    const actual = finish(run)

    // then
    expect(actual).toEqual(1)
    expect(
      rowsOf<{ status: string }>(dbPath, 'SELECT status FROM sessions'),
    ).toEqual([{ status: 'fail' }])
    run.tracer.close()
  },
)

test(
  [
    'given use-cases/run-activity-run::finish',
    'when finish runs in a process that recorded none of the run\u2019s activity runs itself',
    'it should still judge the rows recorded by an earlier process, reading them through the tracer (1.2.1, 1.5.4)',
  ].join(', '),
  async () => {
    // given \u2014 one process opens and finishes an activity run
    const dir = mkdtempSync(join(tmpdir(), 'crust-run-activityRun-test-'))
    const dbPath = join(dir, 'crust.db')
    const cfg = crustConfigSchema.parse({
      defaults: { data_dir: join(dir, 'data') },
      observability: { db: dbPath },
      agents: [],
    })
    const firstTracer = createTracer(
      dbPath,
      join(dir, 'data', 'sessions', 'test0002', 'events.jsonl'),
    )
    firstTracer.sessionStart('test0002', 'tester', 'quality')
    const firstRun = createRun({
      cfg,
      runId: 'test0002',
      tracer: firstTracer,
      engineer: 'tester',
    })
    await runActivityRun(firstRun)(
      activityRunParams({
        name: 'build',
        kind: 'agent',
        owner: 'builder',
        description: 'Implement the design',
      }),
      () => 'ok',
    )
    firstTracer.close()

    // when \u2014 a second process opens the SAME run, recording nothing of its own
    const secondTracer = createTracer(
      dbPath,
      join(dir, 'data', 'sessions', 'test0002', 'events.jsonl'),
    )
    const secondRun = createRun({
      cfg,
      runId: 'test0002',
      tracer: secondTracer,
      engineer: 'tester',
    })
    expect(secondRun.activityRuns()).toEqual([])
    const actual = finish(secondRun)

    // then \u2014 judged on the recorded row, not the (empty) in-memory list
    expect(actual).toEqual(0)
    expect(
      rowsOf<{ status: string }>(dbPath, 'SELECT status FROM sessions'),
    ).toEqual([{ status: 'success' }])
    secondTracer.close()
  },
)

test(
  [
    'given use-cases/run-activity-run::finish',
    'when the run is both unaccepted and holds a failed activity run',
    'it should record both reasons (1.3.3, 1.5.5)',
  ].join(', '),
  async () => {
    // given
    const { run, dbPath } = scratchRun()
    const activityRun = runActivityRun(run)
    await activityRun(
      activityRunParams({
        name: 'build',
        kind: 'agent',
        owner: 'builder',
        description: 'Implement the design',
      }),
      () => 'ok',
    )
    const row = run
      .activityRuns()
      .find((candidate) => candidate.params.name === 'build')
    if (row !== undefined) {
      run.tracer.activityRunUpsert(
        run.updateActivityRun(row.activity_run_id, { status: 'fail' }),
      )
    }

    // when
    const actual = finish(run, {
      accepted: false,
      reason: 'the suite still failed',
    })

    // then \u2014 both reasons recorded, neither hiding behind the other
    expect(actual).toEqual(1)
    const events = rowsOf<{ name: string }>(
      dbPath,
      "SELECT name FROM events WHERE type='error'",
    )
    expect(events.map((event) => event.name)).toEqual(
      expect.arrayContaining(['activity_runs_failed', 'not_accepted']),
    )
    run.tracer.close()
  },
)

test(
  [
    'given use-cases/run-activity-run::counts',
    'when an activity run status is superseded',
    'it should not count',
  ].join(', '),
  () => {
    expect(counts({ status: 'superseded' })).toEqual(false)
    expect(counts({ status: 'success' })).toEqual(true)
    expect(counts({ status: 'fail' })).toEqual(true)
  },
)

test(
  [
    'given use-cases/run-activity-run::runActivityRun',
    'when one activity overwrites a document an earlier activity wrote',
    'it should refuse the write, and restore the original if it lands anyway',
  ].join(', '),
  async () => {
    // given — the failure this exists for. Every agent is granted the whole
    // session directory, and the directory is gitignored, so nothing forbade
    // this and git could not undo it. The second activity writes by brute force,
    // lifting the mode first, to stand in for the paths a lock cannot cover:
    // a shell redirect after a chmod, or an unlink, which the directory's
    // permission governs rather than the file's.
    const { run, dbPath } = scratchRun()
    const design = join(run.contextHandoffDir, 'design.md')

    await runActivityRun(run)(
      activityRunParams({
        name: 'design',
        kind: 'agent',
        owner: 'technical-architect',
        description: 'Give the architecture a physical shape',
      }),
      () => {
        writeFileSync(design, 'the approved design')
      },
    )

    // when — a later activity tries the ordinary way, then forces it
    const refused = await runActivityRun(run)(
      activityRunParams({
        name: 'build',
        kind: 'agent',
        owner: 'builder',
        description: 'Implement the design',
      }),
      () => {
        // biome-ignore lint/plugin/no-intermediate-try-catch: the test observes the lock's refusal and forces past it; there is no settlement boundary below this body
        try {
          writeFileSync(design, 'somebody else of the same name')
          return 'written'
        } catch (cause) {
          chmodSync(design, 0o644)
          writeFileSync(design, 'somebody else of the same name')
          return (cause as NodeJS.ErrnoException).code ?? 'refused'
        }
      },
    )

    // then — the lock stopped the ordinary write
    expect(refused).toEqual('EACCES')
    // and what got through by force was put back
    expect(readFileSync(design, 'utf8')).toEqual('the approved design')
    // and the run says so, naming the activity that did it
    const events = rowsOf<{ name: string; payload_json: string }>(
      dbPath,
      "select name, payload_json from events where type='artifacts' order by rowid",
    )
    expect(events.map((row) => row.name)).toEqual([
      'design artifacts',
      'build artifacts',
      'build restored',
    ])
    expect(JSON.parse(events[2]?.payload_json ?? '{}').restored).toEqual([
      'design.md',
    ])
  },
)

test(
  [
    'given use-cases/run-activity-run::runActivityRun',
    'when the activity that wrote a document runs a second time',
    'it should be allowed to replace its own output',
  ].join(', '),
  async () => {
    // given — a retry, or a rejection sending the activity back, legitimately
    // produces a new design. Locking that would break the ordinary path.
    const { run } = scratchRun()
    const design = join(run.contextHandoffDir, 'design.md')
    const write = (text: string) => () => {
      writeFileSync(design, text)
    }

    // when
    await runActivityRun(run)(
      activityRunParams({
        name: 'design',
        kind: 'agent',
        owner: 'technical-architect',
        description: 'Give the architecture a physical shape',
      }),
      write('first'),
    )
    await runActivityRun(run)(
      activityRunParams({
        name: 'design',
        kind: 'agent',
        owner: 'technical-architect',
        description: 'Give the architecture a physical shape',
      }),
      write('second'),
    )

    // then
    expect(readFileSync(design, 'utf8')).toEqual('second')
  },
)

test(
  [
    'given use-cases/run-activity-run::runActivityRun',
    'when an earlier artifacts event for this activity carries a malformed created field',
    'it should treat it as nothing created, rather than throw',
  ].join(', '),
  async () => {
    // given \u2014 a row from before `created` existed, or written by hand
    const { run } = scratchRun()
    run.tracer.event({
      run_id: run.runId,
      activity_run_id: 'test0001_00_design',
      type: 'artifacts',
      name: 'design artifacts',
      payload: { created: 'not-an-array' },
    })
    const design = join(run.contextHandoffDir, 'design.md')

    // when
    const act = () =>
      runActivityRun(run)(
        activityRunParams({
          name: 'design',
          kind: 'agent',
          owner: 'technical-architect',
          description: 'Give the architecture a physical shape',
        }),
        () => {
          writeFileSync(design, 'the approved design')
        },
      )

    // then
    await expect(act()).resolves.toBeUndefined()
  },
)

test(
  [
    'given use-cases/run-activity-run::runActivityRun',
    'when an activity run fails after writing a document',
    'it should still record and protect what it wrote',
  ].join(', '),
  async () => {
    // given — a failed activity's document is often exactly the one a reader
    // wants, so observation runs on the failure path too
    const { run, dbPath } = scratchRun()
    const diagnosis = join(run.contextHandoffDir, 'diagnosis.md')

    // when
    await expect(
      runActivityRun(run)(
        activityRunParams({
          name: 'diagnose',
          kind: 'agent',
          owner: 'diagnostician',
          description: 'Find the root cause',
        }),
        () => {
          writeFileSync(diagnosis, 'what went wrong')
          throw new Error('the activity then failed')
        },
      ),
    ).rejects.toThrow('the activity then failed')

    // then
    const events = rowsOf<{ name: string; payload_json: string }>(
      dbPath,
      "select name, payload_json from events where type='artifacts'",
    )
    expect(JSON.parse(events[0]?.payload_json ?? '{}').created).toEqual([
      'diagnosis.md',
    ])
    expect(statSync(diagnosis).mode & 0o222).toEqual(0)
  },
)

test(
  [
    'given use-cases/run-activity-run::finishWaiting',
    'when a run stops to wait for a person',
    'it should mark the session waiting and exit WAITING, not a failure',
  ].join(', '),
  () => {
    // given
    const { run, dbPath } = scratchRun()

    // when
    const actual = finishWaiting(
      run,
      join(run.contextHandoffDir, 'decision-request.md'),
    )

    // then
    expect(actual).toEqual(EXIT.WAITING)
    expect(
      rowsOf<{ status: string }>(dbPath, 'SELECT status FROM sessions'),
    ).toEqual([{ status: 'waiting' }])
    run.tracer.close()
  },
)
