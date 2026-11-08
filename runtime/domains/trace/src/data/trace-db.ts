/**
 * Tracer: every event lands in JSONL and SQLite AS IT HAPPENS.
 *
 * Files are the raw record; crust.db is the queryable mirror the UI polls.
 * No push transport — the flow is always: agents -> sqlite -> web ui.
 * WAL mode so the UI can read while workflow processes write.
 */

import { Database } from 'bun:sqlite'
import { dirname } from 'node:path'
import type {
  TActivityRun,
  TAgentConfig,
  TEventInput,
  TGateReport,
  TTracer,
} from '../../../../lib/contracts'
import { reportPassed, violationsOf } from '../../../../lib/contracts'
import { appendText, ensureDir, newId, nowIso } from '../../../../lib/system'
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  run_id        TEXT PRIMARY KEY,
  lifecycle      TEXT,                -- stage(s) or lifecycle(s) run, e.g. "plan + build"
  request       TEXT,
  status        TEXT,
  engineer      TEXT,
  started_at    TEXT, ended_at TEXT,
  total_tokens  INTEGER DEFAULT 0, total_cost REAL DEFAULT 0,
  archived      INTEGER DEFAULT 0,  -- review triage, set by the UI; never by a run
  workspace_root TEXT,              -- the working tree this run ran in
  branch        TEXT,               -- the branch it was on when it started
  name          TEXT                -- --name, verbatim; display clips, storage does not
);
CREATE TABLE IF NOT EXISTS activity_runs (
  activity_run_id      TEXT PRIMARY KEY,
  run_id        TEXT REFERENCES sessions,
  seq           INTEGER,
  name TEXT, kind TEXT, owner TEXT, description TEXT,
  status        TEXT DEFAULT 'fail',
  error         TEXT,
  started_at    TEXT, ended_at TEXT
);
CREATE TABLE IF NOT EXISTS events (
  event_id      TEXT PRIMARY KEY,
  run_id        TEXT REFERENCES sessions,
  activity_run_id      TEXT REFERENCES activity_runs,
  parent_id     TEXT,
  type          TEXT,
  name          TEXT,
  payload_json  TEXT,
  tokens        INTEGER,
  started_at    TEXT, ended_at TEXT
);
CREATE TABLE IF NOT EXISTS envelopes (
  envelope_id   TEXT PRIMARY KEY,
  run_id        TEXT REFERENCES sessions,
  activity_run_id      TEXT REFERENCES activity_runs,
  agent         TEXT,
  output_type   TEXT,
  payload_json  TEXT,
  valid         INTEGER,
  created_at    TEXT
);
CREATE TABLE IF NOT EXISTS gate_results (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id        TEXT REFERENCES sessions,
  activity_run_id      TEXT REFERENCES activity_runs,
  gate          TEXT,
  passed        INTEGER,
  violations_json TEXT,
  checks_json   TEXT,               -- [{item, ok, note}] — WHAT the gate verified
  created_at    TEXT
);
CREATE TABLE IF NOT EXISTS processes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id        TEXT REFERENCES sessions,
  kind          TEXT,                -- 'run' (the lifecycle's own process) | 'agent' (a coding-agent child)
  name          TEXT,                -- '' for the workflow, the agent name for a child
  pid           INTEGER,
  command       TEXT,                -- what the pid was, so a recycled pid is not killed by mistake
  started_at    TEXT, ended_at TEXT  -- ended_at NULL = believed alive
);
CREATE TABLE IF NOT EXISTS agent_sessions (
  run_id        TEXT REFERENCES sessions,
  agent         TEXT,
  coding_agent  TEXT, model TEXT, color TEXT,
  session_id    TEXT,
  context_tokens INTEGER,           -- window occupancy after the agent's last turn
  context_window INTEGER,           -- the model's ceiling; 0/NULL = unknown
  created_at    TEXT, last_used_at TEXT,
  PRIMARY KEY (run_id, agent)
);

-- Every events lookup the visualizer makes is keyed on run_id, and the two hot
-- ones add a type: agentsFor() wants 'agent_start', usage() wants 'agent_end'.
-- Unindexed, each one scans every event the tracer has ever written.
--
-- The second column is load-bearing rather than incidental. The sessions list
-- asks agentsFor() for EVERY run id it just listed, so run_id alone narrows
-- nothing on that query — measured on a 2M-event database it picked the index
-- and stayed at ~3.4s. With type in the index the same query is ~0.7ms, and
-- run_id remains a usable prefix for the cursor poll that has no type.
CREATE INDEX IF NOT EXISTS idx_events_run_id_type ON events(run_id, type);

-- 1.5.x briefly shipped the run_id-only index this one supersedes. It is a
-- strict subset of the composite, so a database that already has it is paying
-- for a second copy of the same prefix and gaining nothing. Dropping an index
-- removes no rows and the statement is a no-op where it never existed.
DROP INDEX IF EXISTS idx_events_run_id;
`

/**
 * Columns added after a schema shipped. CREATE TABLE IF NOT EXISTS never
 * revisits an existing table, so additive changes need an explicit ALTER.
 */
export const MIGRATIONS: ReadonlyArray<readonly [string, string, string]> = [
  ['agent_sessions', 'color', 'TEXT'],
  ['gate_results', 'checks_json', 'TEXT'],
  ['sessions', 'lifecycle', 'TEXT'],
  ['agent_sessions', 'context_tokens', 'INTEGER'],
  ['agent_sessions', 'context_window', 'INTEGER'],
  ['sessions', 'archived', 'INTEGER DEFAULT 0'],
  ['sessions', 'workspace_root', 'TEXT'],
  ['sessions', 'branch', 'TEXT'],
  ['sessions', 'name', 'TEXT'],
  // The VCS root, when it differs from workspace_root -- a workspace nested
  // inside a larger repository. '' for an older row and for the ordinary
  // case where the two are equal; see
  // specs/todos/FIX-WORKSPACE-AND-VCS-ROOTS.md -- 1.5.2.
  ['sessions', 'vcs_root', 'TEXT'],
]

/** Additive column migrations, so a db from an older pi-crust still opens. */
const migrate = (db: Database): void => {
  for (const [table, column, declaration] of MIGRATIONS) {
    const columns = db
      .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
      .all()
      .map((row) => row.name)
    if (!columns.includes(column)) {
      db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`)
    }
  }
}

export const createTracer = (
  dbPath: string,
  eventsJsonlPath: string,
): TTracer => {
  ensureDir(dirname(dbPath))
  ensureDir(dirname(eventsJsonlPath))
  const db = new Database(dbPath, { create: true })
  db.run('PRAGMA journal_mode=WAL;')
  db.run('PRAGMA synchronous=NORMAL;')
  db.run('PRAGMA busy_timeout=5000;')
  db.run(SCHEMA)
  migrate(db)

  const event = (input: TEventInput): string => {
    const eventId = `evt_${newId(12)}`
    const ts = nowIso()
    const record = {
      run_id: input.run_id,
      activity_run_id: input.activity_run_id ?? '',
      type: input.type,
      name: input.name ?? '',
      payload: input.payload ?? {},
      parent_id: input.parent_id ?? '',
      tokens: input.tokens ?? null,
      started_at: input.started_at ?? null,
      ended_at: input.ended_at ?? null,
    }
    appendText(
      eventsJsonlPath,
      `${JSON.stringify({ event_id: eventId, ts, ...record })}\n`,
    )
    db.run(
      'INSERT INTO events (event_id, run_id, activity_run_id, parent_id, type, name,' +
        ' payload_json, tokens, started_at, ended_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [
        eventId,
        record.run_id,
        record.activity_run_id,
        record.parent_id,
        record.type,
        record.name,
        JSON.stringify(record.payload),
        record.tokens,
        record.started_at ?? ts,
        record.ended_at,
      ],
    )
    return eventId
  }

  const processesEndAll = (runId: string): void => {
    db.run(
      'UPDATE processes SET ended_at=? WHERE run_id=? AND ended_at IS NULL',
      [nowIso(), runId],
    )
  }

  /**
   * Close any activityRun the run left open, because the run is over and it is not.
   *
   * A activityRun goes `running` when it starts and is updated when it settles. A
   * run killed mid-activityRun — Ctrl-C, a crash, a terminal closing — never reaches
   * that update, so the row stays `running` forever: the session reads `fail`
   * while the activityRun under it claims to still be working, with no process
   * behind it. `just crust activityRuns` and the visualizer both repeat the claim,
   * and a reader cannot tell an interrupted run from a live one.
   *
   * Whatever ends a run ends its activityRuns. `ended_at` is left alone when the
   * activityRun already had one, so this only touches rows that never settled.
   */
  const activityRunsAbandon = (runId: string, reason: string): void => {
    db.run(
      "UPDATE activity_runs SET status='fail', error=COALESCE(error, ?), " +
        'ended_at=COALESCE(ended_at, ?) WHERE run_id=? AND status=?',
      [reason, nowIso(), runId, 'running'],
    )
  }

  return {
    dbPath,
    event,

    // ── sessions ────────────────────────────────────────────────────────────
    sessionStart: (runId, engineer, lifecycleName, name) => {
      db.run(
        'INSERT INTO sessions (run_id, status, engineer, started_at) VALUES (?,?,?,?) ' +
          "ON CONFLICT(run_id) DO UPDATE SET status='running'",
        [runId, 'running', engineer, nowIso()],
      )
      /*
       * SET, never appended — unlike `lifecycle` below, a label containing a
       * literal ' + ' must not be split on read. An absent or empty `name`
       * leaves whatever is already there: a resume that omits the flag must
       * not erase the label the run was given when it started.
       */
      if (name) {
        db.run('UPDATE sessions SET name=? WHERE run_id=?', [name, runId])
      }
      if (!lifecycleName) {
        return
      }
      // A joined session chains workflows — record each distinct one, in run order.
      const row = db
        .query<{ lifecycle: string | null }, [string]>(
          'SELECT lifecycle FROM sessions WHERE run_id=?',
        )
        .get(runId)
      const names = row?.lifecycle ? row.lifecycle.split(' + ') : []
      if (!names.includes(lifecycleName)) {
        db.run('UPDATE sessions SET lifecycle=? WHERE run_id=?', [
          [...names, lifecycleName].join(' + '),
          runId,
        ])
      }
    },

    /*
     * Which working tree this run belongs to.
     *
     * Separate from `sessionStart` because it answers a different question and
     * can be answered again later: a run that creates a branch mid-flight
     * moves, and one observer watching several worktrees needs to say WHERE
     * each run is, not only that it exists. Absent on rows written before this
     * column, which is why a reader must treat it as unknown rather than as
     * the observer's own tree.
     */
    sessionWorkspace: (runId, workspaceRoot, branch, vcsRoot = '') => {
      db.run(
        'UPDATE sessions SET workspace_root=?, branch=?, vcs_root=? WHERE run_id=?',
        [workspaceRoot, branch, vcsRoot, runId],
      )
    },

    sessionRequest: (runId, request) => {
      db.run('UPDATE sessions SET request=? WHERE run_id=?', [
        request.slice(0, 500),
        runId,
      ])
    },

    /**
     * The run stopped for a person and is not finished.
     *
     * `ended_at` is set because no process is alive, but the status is its
     * own: a reader seeing `fail` would go looking for what broke, and
     * nothing did.
     */
    sessionWaiting: (runId) => {
      db.run('UPDATE sessions SET status=?, ended_at=? WHERE run_id=?', [
        'waiting',
        nowIso(),
        runId,
      ])
      processesEndAll(runId)
      // A gate opens between activityRuns, so there should be none open. If there
      // is, it did not finish, and saying so beats leaving it mid-sentence.
      activityRunsAbandon(
        runId,
        'the run stopped for a person while this activityRun was open',
      )
    },

    sessionFinish: (runId, ok) => {
      db.run('UPDATE sessions SET status=?, ended_at=? WHERE run_id=?', [
        ok ? 'success' : 'fail',
        nowIso(),
        runId,
      ])
      processesEndAll(runId) // nothing of this run is alive any more
      activityRunsAbandon(
        runId,
        'the run ended while this activityRun was still running — interrupted, or it ' +
          'died without settling',
      )
    },

    eventsNamed: (runId, name) =>
      (
        db
          .query(
            'SELECT payload_json FROM events WHERE run_id=? AND name=? ORDER BY rowid',
          )
          .all(runId, name) as { payload_json: string | null }[]
      ).flatMap((row) => {
        if (row.payload_json === null) return []
        // biome-ignore lint/plugin: this layer owns the boundary
        try {
          const parsed: unknown = JSON.parse(row.payload_json)
          return parsed !== null && typeof parsed === 'object'
            ? [parsed as Record<string, unknown>]
            : []
        } catch (cause) {
          void cause
          return []
        }
      }),

    sessionAddUsage: (runId, tokens, cost) => {
      db.run(
        'UPDATE sessions SET total_tokens=total_tokens+?, total_cost=total_cost+? WHERE run_id=?',
        [tokens, cost, runId],
      )
    },

    // ── processes (run_id → pid, so a hung run can be found and killed) ─────
    /**
     * A coding agent that hangs produces no events at all, which is exactly
     * when you need its pid — and `ps` cannot tell you which run_id it belongs
     * to. Writing it here makes the trace the answer to "what is this run
     * running, and how do I stop it".
     */
    processStart: (runId, kind, name, pid, command) => {
      db.run(
        'INSERT INTO processes (run_id, kind, name, pid, command, started_at)' +
          ' VALUES (?,?,?,?,?,?)',
        [runId, kind, name, pid, command.slice(0, 500), nowIso()],
      )
    },

    /** Mark the newest live row for this pid as finished. */
    processEnd: (runId, pid) => {
      db.run(
        'UPDATE processes SET ended_at=? WHERE id = (' +
          '  SELECT id FROM processes WHERE run_id=? AND pid=? AND ended_at IS NULL' +
          '  ORDER BY id DESC LIMIT 1)',
        [nowIso(), runId, pid],
      )
    },

    processesEndAll,

    // ── activityRuns ──────────────────────────────────────────────────────────────
    /**
     * Highest seq already recorded for this session; 0 when it is new.
     *
     * A joined run continues the sequence instead of restarting at 1 — which
     * would collide with the first run's activityRuns on both `seq` (breaking
     * ordering) and `activity_run_id` (silently overwriting a row through the
     * activityRunUpsert conflict clause).
     */
    maxActivityRunSeq: (runId) => {
      const row = db
        .query<{ max_seq: number | null }, [string]>(
          'SELECT MAX(seq) AS max_seq FROM activity_runs WHERE run_id = ?',
        )
        .get(runId)
      return row?.max_seq ?? 0
    },

    /**
     * Every activity run recorded for this run, in seq order.
     *
     * Read from the table rather than any in-memory list: this is what lets
     * `finish` judge a run it did not entirely create itself (1.2.1 of
     * specs/todos/FIX-SUPERSEDED-RUN-VERDICT.md).
     */
    activityRunsFor: (runId: string): readonly TActivityRun[] =>
      db
        .query<
          {
            activity_run_id: string
            run_id: string
            seq: number
            name: string
            kind: TActivityRun['params']['kind']
            owner: string
            description: string | null
            status: TActivityRun['status']
            error: string | null
            started_at: string | null
            ended_at: string | null
          },
          [string]
        >('SELECT * FROM activity_runs WHERE run_id = ? ORDER BY seq')
        .all(runId)
        .map((row) => ({
          activity_run_id: row.activity_run_id,
          run_id: row.run_id,
          seq: row.seq,
          params: {
            name: row.name,
            kind: row.kind,
            owner: row.owner,
            description: row.description ?? '',
          },
          status: row.status,
          error: row.error ?? undefined,
          started_at: row.started_at ?? undefined,
          ended_at: row.ended_at ?? undefined,
        })),

    activityRunUpsert: (activityRun: TActivityRun) => {
      const p = activityRun.params
      db.run(
        'INSERT INTO activity_runs (activity_run_id, run_id, seq, name, kind, owner, description,' +
          ' status, error, started_at, ended_at)' +
          ' VALUES (?,?,?,?,?,?,?,?,?,?,?)' +
          ' ON CONFLICT(activity_run_id) DO UPDATE SET status=excluded.status,' +
          ' error=excluded.error, ended_at=excluded.ended_at',
        [
          activityRun.activity_run_id,
          activityRun.run_id,
          activityRun.seq,
          p.name,
          p.kind,
          p.owner,
          p.description,
          activityRun.status,
          activityRun.error ?? null,
          activityRun.started_at ?? null,
          activityRun.ended_at ?? null,
        ],
      )
    },

    // ── envelopes / gates / agent sessions ──────────────────────────────────
    envelopeRow: (activityRun, agent, outputType, payloadJson, valid) => {
      db.run(
        'INSERT INTO envelopes (envelope_id, run_id, activity_run_id, agent, output_type,' +
          ' payload_json, valid, created_at) VALUES (?,?,?,?,?,?,?,?)',
        [
          `env_${newId(12)}`,
          activityRun.run_id,
          activityRun.activity_run_id,
          agent,
          outputType,
          payloadJson,
          valid ? 1 : 0,
          nowIso(),
        ],
      )
    },

    /** The report carries both the verdict and the evidence behind it. */
    gateRow: (activityRun, gate, report: TGateReport) => {
      db.run(
        'INSERT INTO gate_results (run_id, activity_run_id, gate, passed,' +
          ' violations_json, checks_json, created_at) VALUES (?,?,?,?,?,?,?)',
        [
          activityRun.run_id,
          activityRun.activity_run_id,
          gate,
          reportPassed(report) ? 1 : 0,
          JSON.stringify(violationsOf(report)),
          JSON.stringify(report.checks),
          nowIso(),
        ],
      )
    },

    /**
     * The agent's config row is the source of truth for its label and color.
     *
     * Context is carried here rather than derived from events because the lane
     * wants one number per agent — the latest — and a session that runs the
     * same agent twice overwrites it, exactly like model and session_id.
     */
    agentSessionRow: (
      runId,
      agent: TAgentConfig,
      sessionId,
      contextTokens,
      contextWindow,
    ) => {
      const ts = nowIso()
      db.run(
        'INSERT INTO agent_sessions (run_id, agent, coding_agent, model, color,' +
          ' session_id, context_tokens, context_window, created_at, last_used_at)' +
          ' VALUES (?,?,?,?,?,?,?,?,?,?)' +
          ' ON CONFLICT(run_id, agent) DO UPDATE SET model=excluded.model,' +
          ' color=excluded.color, session_id=excluded.session_id,' +
          ' context_tokens=excluded.context_tokens,' +
          ' context_window=excluded.context_window,' +
          ' last_used_at=excluded.last_used_at',
        [
          runId,
          agent.name,
          agent.coding_agent,
          agent.model,
          agent.color,
          sessionId,
          contextTokens,
          contextWindow,
          ts,
          ts,
        ],
      )
    },

    close: () => db.close(),
  }
}
