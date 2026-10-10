import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
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
import { crustConfigSchema } from '../typedefs/config'
import { phaseParams } from '../typedefs/phase'
import type { TRun } from '../typedefs/run'
import { createRun } from './create-run'
import { finish, runPhase } from './run-phase'

const scratchRun = (): Readonly<{ run: TRun; dbPath: string }> => {
  const dir = mkdtempSync(join(tmpdir(), 'crust-run-phase-test-'))
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
    'given use-cases/run-phase::runPhase',
    'when a phase body completes cleanly',
    'it should record success and return the body result',
  ].join(', '),
  async () => {
    // given
    const { run, dbPath } = scratchRun()
    const phase = runPhase(run)

    // when
    const actual = await phase(
      phaseParams({
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
        'SELECT name, status, description FROM phases',
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
    'given use-cases/run-phase::runPhase',
    'when a phase body throws',
    'it should record the failure, finalize the session, and rethrow',
  ].join(', '),
  async () => {
    // given
    const { run, dbPath } = scratchRun()
    const phase = runPhase(run)
    await phase(
      phaseParams({
        name: 'request',
        kind: 'engineer',
        owner: 'tester',
        description: 'Capture the incoming ask',
      }),
      () => undefined,
    )

    // when
    const thrown = await phase(
      phaseParams({
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
        'SELECT name, status FROM phases ORDER BY seq',
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
        "SELECT type FROM events WHERE type IN ('error','phase_end') ORDER BY rowid",
      ).map((row) => row.type),
    ).toEqual(['phase_end', 'error', 'phase_end'])
    run.tracer.close()
  },
)

test(
  [
    'given use-cases/run-phase::finish',
    'when every phase passed but the run was not accepted',
    'it should exit 1, record not_accepted, and mark the session failed',
  ].join(', '),
  async () => {
    // given
    const { run, dbPath } = scratchRun()
    const phase = runPhase(run)
    await phase(
      phaseParams({
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
    'given use-cases/run-phase::finish',
    'when every phase passed and the run was accepted',
    'it should exit 0 and mark the session successful',
  ].join(', '),
  async () => {
    // given
    const { run, dbPath } = scratchRun()
    const phase = runPhase(run)
    await phase(
      phaseParams({
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
    'given use-cases/run-phase::finish',
    'when the run opened no phases at all',
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
    'given use-cases/run-phase::runPhase',
    'when one step overwrites a document an earlier step wrote',
    'it should refuse the write, and restore the original if it lands anyway',
  ].join(', '),
  async () => {
    // given — the failure this exists for. Every agent is granted the whole
    // session directory, and the directory is gitignored, so nothing forbade
    // this and git could not undo it. The second step writes by brute force,
    // lifting the mode first, to stand in for the paths a lock cannot cover:
    // a shell redirect after a chmod, or an unlink, which the directory's
    // permission governs rather than the file's.
    const { run, dbPath } = scratchRun()
    const design = join(run.contextHandoffDir, 'design.md')

    await runPhase(run)(phaseParams({
        name: 'design',
        kind: 'agent',
        owner: 'technical-architect',
        description: 'Give the architecture a physical shape',
      }), () => {
      writeFileSync(design, 'the approved design')
    })

    // when — a later step tries the ordinary way, then forces it
    const refused = await runPhase(run)(
      phaseParams({
        name: 'build',
        kind: 'agent',
        owner: 'builder',
        description: 'Implement the design',
      }),
      () => {
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
    // and the run says so, naming the step that did it
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
    'given use-cases/run-phase::runPhase',
    'when the step that wrote a document runs a second time',
    'it should be allowed to replace its own output',
  ].join(', '),
  async () => {
    // given — a retry, or a rejection sending the step back, legitimately
    // produces a new design. Locking that would break the ordinary path.
    const { run } = scratchRun()
    const design = join(run.contextHandoffDir, 'design.md')
    const write = (text: string) => () => {
      writeFileSync(design, text)
    }

    // when
    await runPhase(run)(phaseParams({
        name: 'design',
        kind: 'agent',
        owner: 'technical-architect',
        description: 'Give the architecture a physical shape',
      }), write('first'))
    await runPhase(run)(phaseParams({
        name: 'design',
        kind: 'agent',
        owner: 'technical-architect',
        description: 'Give the architecture a physical shape',
      }), write('second'))

    // then
    expect(readFileSync(design, 'utf8')).toEqual('second')
  },
)

test(
  [
    'given use-cases/run-phase::runPhase',
    'when a phase fails after writing a document',
    'it should still record and protect what it wrote',
  ].join(', '),
  async () => {
    // given — a failed step's document is often exactly the one a reader
    // wants, so observation runs on the failure path too
    const { run, dbPath } = scratchRun()
    const diagnosis = join(run.contextHandoffDir, 'diagnosis.md')

    // when
    await expect(
      runPhase(run)(phaseParams({
        name: 'diagnose',
        kind: 'agent',
        owner: 'diagnostician',
        description: 'Find the root cause',
      }), () => {
        writeFileSync(diagnosis, 'what went wrong')
        throw new Error('the step then failed')
      }),
    ).rejects.toThrow('the step then failed')

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
