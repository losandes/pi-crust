import { Database } from 'bun:sqlite'

type TRecord = Readonly<{
  runId: string
  activity: string
  note: string
  replaying: readonly string[]
  now: () => string
}>
export const recordOverwriteSteer =
  (dbPath: string) =>
  (record: TRecord & Readonly<{ superseding: readonly string[] }>): void => {
    const { runId, activity, note, replaying, superseding, now } = record
    const db = new Database(dbPath)
    db.run('PRAGMA busy_timeout=5000;')
    for (const activityRunId of superseding) {
      db.run(
        "UPDATE activity_runs SET status='superseded' WHERE activity_run_id=?",
        [activityRunId],
      )
    }
    db.run(
      'INSERT INTO events (event_id, run_id, type, name, payload_json, started_at)' +
        ' VALUES (?,?,?,?,?,?)',
      [
        `evt_steer_${Date.now()}`,
        runId,
        'steer',
        `steer ${activity}`,
        JSON.stringify({
          target: 'overwrite',
          activity,
          note,
          replaying,
          superseded: superseding,
          at: now(),
        }),
        now(),
      ],
    )
    db.close()
  }
export const recordBranchSteer =
  (dbPath: string) =>
  (
    record: TRecord &
      Readonly<{
        branchId: string
        seeding: 'fork' | 'fresh'
        carried: readonly string[]
        at: string
      }>,
  ): void => {
    const { runId, activity, note, replaying, branchId, seeding, carried, at } =
      record
    const db = new Database(dbPath)
    db.run('PRAGMA busy_timeout=5000;')
    db.run(
      'INSERT INTO events (event_id, run_id, type, name, payload_json, started_at)' +
        ' VALUES (?,?,?,?,?,?)',
      [
        `evt_branch_${Date.now()}`,
        runId,
        'steer',
        `branch ${activity}`,
        JSON.stringify({
          target: 'branch',
          activity,
          note,
          branch_run_id: branchId,
          seeding,
          replaying,
          at,
        }),
        at,
      ],
    )
    db.run(
      'INSERT INTO events (event_id, run_id, type, name, payload_json, started_at)' +
        ' VALUES (?,?,?,?,?,?)',
      [
        `evt_branched_${Date.now()}`,
        branchId,
        'log',
        'branched_from',
        JSON.stringify({
          from_run_id: runId,
          activity,
          seeding,
          carried: carried,
          at,
        }),
        at,
      ],
    )
    db.close()
  }
