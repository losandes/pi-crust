/**
 * Tracer: every event lands in JSONL and SQLite AS IT HAPPENS.
 *
 * Files are the raw record; crust.db is the queryable mirror the UI polls.
 * No push transport — the flow is always: agents -> sqlite -> web ui.
 * WAL mode so the UI can read while workflow processes write.
 */

import { Database } from 'bun:sqlite'
import { dirname } from 'node:path'
import type { TAgentConfig } from '../typedefs/config'
import type { TGateReport } from '../typedefs/gate'
import { reportPassed, violationsOf } from '../typedefs/gate'
import type { TPhase } from '../typedefs/phase'
import type { TEventInput, TTracer } from '../typedefs/trace'
import { nowIso } from './clock'
import { appendText, ensureDir } from './files'
import { newId } from './ids'

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
  branch        TEXT                -- the branch it was on when it started
);
CREATE TABLE IF NOT EXISTS phases (
  phase_id      TEXT PRIMARY KEY,
  run_id        TEXT REFERENCES sessions,
  seq           INTEGER,
  name TEXT, kind TEXT, owner TEXT, description TEXT,
  status        TEXT DEFAULT 'fail',
  attempt       INTEGER DEFAULT 0, retries INTEGER DEFAULT 0,
  error         TEXT,
  started_at    TEXT, ended_at TEXT
);
CREATE TABLE IF NOT EXISTS events (
  event_id      TEXT PRIMARY KEY,
  run_id        TEXT REFERENCES sessions,
  phase_id      TEXT REFERENCES phases,
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
  phase_id      TEXT REFERENCES phases,
  agent         TEXT,
  output_type   TEXT,
  payload_json  TEXT,
  valid         INTEGER,
  attempt       INTEGER,
  created_at    TEXT
);
CREATE TABLE IF NOT EXISTS gate_results (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id        TEXT REFERENCES sessions,
  phase_id      TEXT REFERENCES phases,
  attempt       INTEGER,
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
      phase_id: input.phase_id ?? '',
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
      'INSERT INTO events (event_id, run_id, phase_id, parent_id, type, name,' +
        ' payload_json, tokens, started_at, ended_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [
        eventId,
        record.run_id,
        record.phase_id,
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
   * Close any phase the run left open, because the run is over and it is not.
   *
   * A phase goes `running` when it starts and is updated when it settles. A
   * run killed mid-phase — Ctrl-C, a crash, a terminal closing — never reaches
   * that update, so the row stays `running` forever: the session reads `fail`
   * while the phase under it claims to still be working, with no process
   * behind it. `just crust phases` and the visualizer both repeat the claim,
   * and a reader cannot tell an interrupted run from a live one.
   *
   * Whatever ends a run ends its phases. `ended_at` is left alone when the
   * phase already had one, so this only touches rows that never settled.
   */
  const phasesAbandon = (runId: string, reason: string): void => {
    db.run(
      "UPDATE phases SET status='fail', error=COALESCE(error, ?), " +
        'ended_at=COALESCE(ended_at, ?) WHERE run_id=? AND status=?',
      [reason, nowIso(), runId, 'running'],
    )
  }

  return {
    dbPath,
    event,

    // ── sessions ────────────────────────────────────────────────────────────
    sessionStart: (runId, engineer, lifecycleName) => {
      db.run(
        'INSERT INTO sessions (run_id, status, engineer, started_at) VALUES (?,?,?,?) ' +
          "ON CONFLICT(run_id) DO UPDATE SET status='running'",
        [runId, 'running', engineer, nowIso()],
      )
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
    sessionWorkspace: (runId, workspaceRoot, branch) => {
      db.run('UPDATE sessions SET workspace_root=?, branch=? WHERE run_id=?', [
        workspaceRoot,
        branch,
        runId,
      ])
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
      // A gate opens between phases, so there should be none open. If there
      // is, it did not finish, and saying so beats leaving it mid-sentence.
      phasesAbandon(runId, 'the run stopped for a person while this phase was open')
    },

    sessionFinish: (runId, ok) => {
      db.run('UPDATE sessions SET status=?, ended_at=? WHERE run_id=?', [
        ok ? 'success' : 'fail',
        nowIso(),
        runId,
      ])
      processesEndAll(runId) // nothing of this run is alive any more
      phasesAbandon(
        runId,
        'the run ended while this phase was still running — interrupted, or it ' +
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

    // ── phases ──────────────────────────────────────────────────────────────
    /**
     * Highest seq already recorded for this session; 0 when it is new.
     *
     * A joined run continues the sequence instead of restarting at 1 — which
     * would collide with the first run's phases on both `seq` (breaking
     * ordering) and `phase_id` (silently overwriting a row through the
     * phaseUpsert conflict clause).
     */
    maxPhaseSeq: (runId) => {
      const row = db
        .query<{ max_seq: number | null }, [string]>(
          'SELECT MAX(seq) AS max_seq FROM phases WHERE run_id = ?',
        )
        .get(runId)
      return row?.max_seq ?? 0
    },

    phaseUpsert: (phase: TPhase) => {
      const p = phase.params
      db.run(
        'INSERT INTO phases (phase_id, run_id, seq, name, kind, owner, description,' +
          ' status, attempt, retries, error, started_at, ended_at)' +
          ' VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)' +
          ' ON CONFLICT(phase_id) DO UPDATE SET status=excluded.status,' +
          ' attempt=excluded.attempt, error=excluded.error, ended_at=excluded.ended_at',
        [
          phase.phase_id,
          phase.run_id,
          phase.seq,
          p.name,
          p.kind,
          p.owner,
          p.description,
          phase.status,
          phase.attempt,
          p.retries,
          phase.error ?? null,
          phase.started_at ?? null,
          phase.ended_at ?? null,
        ],
      )
    },

    // ── envelopes / gates / agent sessions ──────────────────────────────────
    envelopeRow: (phase, agent, outputType, payloadJson, valid, attempt) => {
      db.run(
        'INSERT INTO envelopes (envelope_id, run_id, phase_id, agent, output_type,' +
          ' payload_json, valid, attempt, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        [
          `env_${newId(12)}`,
          phase.run_id,
          phase.phase_id,
          agent,
          outputType,
          payloadJson,
          valid ? 1 : 0,
          attempt,
          nowIso(),
        ],
      )
    },

    /** The report carries both the verdict and the evidence behind it. */
    gateRow: (phase, gate, report: TGateReport, attempt) => {
      db.run(
        'INSERT INTO gate_results (run_id, phase_id, attempt, gate, passed,' +
          ' violations_json, checks_json, created_at) VALUES (?,?,?,?,?,?,?,?)',
        [
          phase.run_id,
          phase.phase_id,
          attempt,
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
