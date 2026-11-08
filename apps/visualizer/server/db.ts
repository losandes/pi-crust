/**
 * SQLite reader over a target repo's crust.db.
 *
 * The read connection is opened readonly and every query on it is a SELECT —
 * the writers are the tracers of running lifecycle processes, and WAL lets us read
 * straight through their inserts.
 *
 * ONE exception, opened lazily on its own connection: `setArchived`. Archiving
 * is review triage — "I have looked at this run" — which has to outlive a
 * browser, so it lives on the session row rather than in localStorage. It is
 * the only write this process can make, it touches exactly one column, and it
 * never runs unless a human clicks the button.
 */
import { Database } from 'bun:sqlite'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type {
  ActivityRun,
  AgentSession,
  AgentStartPayload,
  Envelope,
  Event,
  EventsPage,
  GateResult,
  Session,
  SessionDetail,
  SessionSummary,
  SessionUsage,
} from '../shared/types.ts'

/** Where a workspace keeps its trace, relative to the workspace root. */
export const DEFAULT_DB_RELATIVE = '.pi-crust/data/crust.db'
const MAX_LIMIT = 1000
const DEFAULT_LIMIT = 500

/**
 * Expand a leading `~` to the user's home directory (issue #24, 1.1.1,
 * 1.1.2). Duplicated rather than imported from `runtime/domains/workspace/src/data/data-paths.ts`:
 * the server and the factory are separate packages that ship independently
 * (see `workspaces.ts`'s own `realOrRaw` and registry-reading duplication for
 * the same reason), and this is the one rule of that resolver which applies
 * to a value a developer TYPES \u2014 into `--db` or `CRUST_DB` \u2014 rather than one
 * read out of a repository's `crust.config.yaml`. `{primary_worktree}` is not
 * expanded here: that token exists for a committed config value a team
 * shares, not for a one-off flag or environment variable a single developer
 * types at a shell, which is all `resolveDbPath` ever sees.
 */
const expandHome = (value: string): string =>
  value === '~' || value.startsWith('~/')
    ? join(homedir(), value.slice(1))
    : value

/**
 * Resolve the db path: --db arg wins, then CRUST_DB, then <cwd>/.pi-crust/data/crust.db.
 * The db lives in the TARGET repo, so cwd is the repo the visualizer is pointed at.
 */
export function resolveDbPath(
  argv: string[] = Bun.argv,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const flagIndex = argv.indexOf('--db')
  const inline = argv.find((a) => a.startsWith('--db='))
  const raw = expandHome(
    (flagIndex === -1 ? undefined : argv[flagIndex + 1]) ??
      inline?.slice('--db='.length) ??
      env.CRUST_DB ??
      DEFAULT_DB_RELATIVE,
  )

  return isAbsolute(raw) ? raw : resolve(process.cwd(), raw)
}

export class PiCrustDb {
  readonly path: string
  /**
   * Which workspace this database IS.
   *
   * Stamped onto every session row the instance returns, so a run's workspace
   * is which database answered rather than a column that can disagree with
   * where the run actually is.
   */
  readonly label: string
  /**
   * Where the lifecycle session dirs live: `{data_dir}/sessions/{run_id}/{agent}/`.
   * The db sits in the same data_dir (config's `observability.db` defaults to
   * `.pi-crust/data/crust.db`), so deriving it as a sibling of the db file keeps
   * working when the whole data_dir is relocated.
   */
  readonly sessionsDir: string
  readonly journalMode: string
  private readonly db: Database
  /** Opened on first archive and kept; null until then. */
  private writer: Database | null = null
  /** Cache for optionalColumn(), keyed "table.column". Only ever false → true. */
  private readonly columnCache = new Map<string, boolean>()

  constructor(path: string, label = '') {
    if (!existsSync(path)) {
      throw new Error(
        `crust.db not found at ${path}\n` +
          `Point the visualizer at a target repo: --db <path> or CRUST_DB=<path>, ` +
          `or run it from a repo root containing ${DEFAULT_DB_RELATIVE}`,
      )
    }
    this.path = path
    this.label = label
    this.sessionsDir = resolve(dirname(path), 'sessions')
    this.db = new Database(path, { readonly: true })

    // WAL is set by the tracer when it creates the db; a readonly connection
    // cannot change it, so we assert rather than set, and always take the
    // busy_timeout so a concurrent writer never turns into a failed request.
    this.db.exec('PRAGMA busy_timeout = 5000')
    this.db.exec('PRAGMA synchronous = NORMAL')
    const mode = this.db
      .query<{ journal_mode: string }, []>('PRAGMA journal_mode')
      .get()
    this.journalMode = mode?.journal_mode ?? 'unknown'
    if (this.journalMode.toLowerCase() !== 'wal') {
      process.stderr.write(
        `[db] journal_mode is "${this.journalMode}", expected "wal" — ` +
          `live reads during agent writes may block\n`,
      )
    }
  }

  /**
   * A SELECT fragment for a column the tracer adds by migration.
   *
   * We open readonly and cannot run those ALTERs ourselves, so selecting one
   * blindly would throw "no such column" on every request against a db an older
   * tracer wrote. Instead we probe and substitute NULL, which reads downstream
   * as "this db predates the column" — the same thing the UI shows for a row
   * the migration didn't backfill.
   *
   * The probe re-runs while the column is missing, because the tracer's ALTER
   * can land while we're serving: a startup-only check would keep returning
   * NULL for the rest of the process even after the data arrived. Once seen,
   * a column never goes away, so it latches.
   */
  private hasColumn(table: string, column: string): boolean {
    const key = `${table}.${column}`
    if (!this.columnCache.get(key)) {
      const cols = this.db
        .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
        .all()
      this.columnCache.set(
        key,
        cols.some((c) => c.name === column),
      )
    }
    return this.columnCache.get(key) ?? false
  }

  private optionalColumn(table: string, column: string): string {
    return this.hasColumn(table, column) ? column : `NULL AS ${column}`
  }

  close(): void {
    this.writer?.close()
    this.db.close()
  }

  /**
   * Archive or restore a session — the only write in this process.
   *
   * busy_timeout matters: a run may be mid-insert on the same WAL db, and a
   * click should wait its turn rather than fail. Returns false when the id
   * does not exist, so the route can 404 instead of silently succeeding.
   */
  setArchived(runId: string, archived: boolean): boolean {
    if (!this.hasColumn('sessions', 'archived')) {
      throw new Error(
        'this db predates the archived column — run any lifecycle once to migrate it',
      )
    }
    if (!this.writer) {
      this.writer = new Database(this.path)
      this.writer.exec('PRAGMA busy_timeout=5000;')
    }
    this.writer
      .query('UPDATE sessions SET archived = ? WHERE run_id = ?')
      .run(archived ? 1 : 0, runId)
    return this.session(runId) !== null
  }

  /**
   * Sessions, most recent first, each with its activityRun statuses for the
   * progress dots.
   *
   * `includeArchived` omits the `archived = 0` constraint entirely rather
   * than widening it, so the default path's SQL and result set are exactly
   * what they were before this flag existed.
   */
  sessions(limit = 200, includeArchived = false): SessionSummary[] {
    const where =
      includeArchived || !this.hasColumn('sessions', 'archived')
        ? ''
        : 'WHERE COALESCE(archived, 0) = 0'
    const rows = this.db
      .query<Session, [number]>(
        `SELECT run_id, ${this.optionalColumn('sessions', 'lifecycle')}, request,
                status, engineer, started_at, ended_at,
                total_tokens, total_cost,
                ${this.optionalColumn('sessions', 'archived')},
                ${this.optionalColumn('sessions', 'workspace_root')},
                ${this.optionalColumn('sessions', 'branch')},
                ${this.optionalColumn('sessions', 'name')}
           FROM sessions
          ${where}
          ORDER BY started_at DESC, rowid DESC
          LIMIT ?`,
      )
      .all(clamp(limit, 1, MAX_LIMIT))

    if (rows.length === 0) return []

    // Embed each session's activityRuns so the L1 progress dots cost no extra request.
    const ids = rows.map((row) => row.run_id)
    const placeholders = ids.map(() => '?').join(', ')
    const activityRunRows = this.db
      .query<ActivityRun, string[]>(
        `SELECT activity_run_id, run_id, seq, name, kind, owner, description, status,
                error, started_at, ended_at
           FROM activity_runs WHERE run_id IN (${placeholders}) ORDER BY seq, rowid`,
      )
      .all(...ids)

    const byRun = new Map<string, ActivityRun[]>()
    for (const activityRun of activityRunRows) {
      const list = byRun.get(activityRun.run_id)
      byRun.set(
        activityRun.run_id,
        list ? [...list, activityRun] : [activityRun],
      )
    }

    // Agents come along too: an L1 card draws a per-agent dot timeline, and its
    // dots are colored per agent — without this it would be one request per card.
    const agentsByAdw = this.agentsFor(ids)

    return rows.map((session) => {
      const activityRuns = byRun.get(session.run_id) ?? []
      return {
        ...session,
        workspace: this.label,
        activityRuns,
        activity_run_count: activityRuns.length,
        agents: agentsByAdw.get(session.run_id) ?? [],
      }
    })
  }

  session(runId: string): Session | null {
    const row = this.db
      .query<Session, [string]>(
        `SELECT run_id, ${this.optionalColumn('sessions', 'lifecycle')}, request,
                status, engineer, started_at, ended_at,
                total_tokens, total_cost,
                ${this.optionalColumn('sessions', 'archived')},
                ${this.optionalColumn('sessions', 'workspace_root')},
                ${this.optionalColumn('sessions', 'branch')},
                ${this.optionalColumn('sessions', 'name')}
           FROM sessions WHERE run_id = ?`,
      )
      .get(runId)
    return row === null || row === undefined
      ? null
      : { ...row, workspace: this.label }
  }

  activityRuns(runId: string): ActivityRun[] {
    return this.db
      .query<ActivityRun, [string]>(
        `SELECT activity_run_id, run_id, seq, name, kind, owner, description, status,
                error, started_at, ended_at
           FROM activity_runs WHERE run_id = ? ORDER BY seq, rowid`,
      )
      .all(runId)
  }

  agentSessions(runId: string): AgentSession[] {
    return this.agentsFor([runId]).get(runId) ?? []
  }

  /**
   * Agents per session, for a set of ids at once: the agent_sessions rows plus
   * anything that has started but not finished.
   *
   * execute-agent.ts writes the agent_sessions row only after the envelope persists, so
   * a running agent has no row there — precisely the case the live view exists
   * for. Its model, color and session_id are already on the agent_start event,
   * so a lane is labelled and colored from the moment the agent spawns.
   */
  private agentsFor(runIds: string[]): Map<string, AgentSession[]> {
    const byRun = new Map<string, AgentSession[]>()
    if (runIds.length === 0) return byRun
    const placeholders = runIds.map(() => '?').join(', ')

    const append = (runId: string, agent: AgentSession) => {
      const list = byRun.get(runId)
      byRun.set(runId, list ? [...list, agent] : [agent])
    }

    const color = this.optionalColumn('agent_sessions', 'color')
    const ctxUsed = this.optionalColumn('agent_sessions', 'context_tokens')
    const ctxWindow = this.optionalColumn('agent_sessions', 'context_window')

    const completed = this.db
      .query<AgentSession, string[]>(
        `SELECT run_id, agent, coding_agent, model, session_id, ${color},
                ${ctxUsed}, ${ctxWindow}, created_at, last_used_at
           FROM agent_sessions WHERE run_id IN (${placeholders})
          ORDER BY created_at, agent`,
      )
      .all(...runIds)
    for (const row of completed) append(row.run_id, row)

    const started = this.db
      .query<
        {
          run_id: string
          agent: string | null
          payload_json: string | null
          started_at: string | null
        },
        string[]
      >(
        `SELECT e.run_id, p.owner AS agent, e.payload_json, e.started_at
           FROM events e JOIN activity_runs p ON p.activity_run_id = e.activity_run_id
          WHERE e.run_id IN (${placeholders}) AND e.type = 'agent_start'
          ORDER BY e.rowid`,
      )
      .all(...runIds)

    for (const row of started) {
      if (!row.agent) continue
      // A finished row is authoritative; only fill genuine gaps.
      if (byRun.get(row.run_id)?.some((a) => a.agent === row.agent)) continue
      let payload: AgentStartPayload = {}
      // biome-ignore lint/plugin/no-intermediate-try-catch: a malformed payload just means no label, never a failed request — this IS the boundary that decides so
      try {
        payload = JSON.parse(row.payload_json ?? '{}') as AgentStartPayload
      } catch {
        // A malformed payload just means no label — never a failed request.
      }
      append(row.run_id, {
        run_id: row.run_id,
        agent: row.agent,
        coding_agent: null,
        model: payload.model ?? null,
        session_id: payload.session_id ?? null,
        color: payload.color ?? null,
        // Occupancy is only known once the agent's turn closes.
        context_tokens: null,
        context_window: null,
        created_at: row.started_at,
        last_used_at: row.started_at,
      })
    }
    return byRun
  }

  /**
   * Session + activityRuns + agents in one shot — L2 needs all three to draw
   * lanes. `handoff_dir` is server-computed from the filesystem rather than a
   * db column, so it is NOT this connection's to fill in: the route handler
   * attaches it.
   */
  sessionDetail(runId: string): Omit<SessionDetail, 'handoff_dir'> | null {
    const session = this.session(runId)
    if (!session) return null

    return {
      session,
      usage: this.usage(runId),
      activityRuns: this.activityRuns(runId),
      agents: this.agentSessions(runId),
    }
  }

  /**
   * Raw tokens read and written, beside the billed headline.
   *
   * Derived from the `agent_end` payloads rather than stored, so every run
   * already in the db gets the split without a migration or a re-run.
   *
   * `total_tokens` is a SPEND number: every turn re-sends the whole
   * conversation, so an 86k conversation over 49 turns bills millions. These
   * two say what actually moved — material read for the first time, and
   * material generated. The gap between them and the headline is cached
   * re-reads, which is usually most of it.
   */
  usage(runId: string): SessionUsage {
    const rows = this.db
      .query<{ payload_json: string | null }, [string]>(
        "SELECT payload_json FROM events WHERE run_id = ? AND type = 'agent_end'",
      )
      .all(runId)

    let read = 0
    let written = 0
    for (const row of rows) {
      if (!row.payload_json) continue
      // biome-ignore lint/plugin/no-intermediate-try-catch: a payload written by an older tracer contributes nothing rather than failing the whole total — this IS the boundary that decides so
      try {
        const u = (
          JSON.parse(row.payload_json) as { usage?: Record<string, number> }
        ).usage
        if (!u) continue
        // RAW reads only: material entering the context for the first time,
        // billed either as uncached input or as a cache write. Cache reads are
        // the same tokens served again on later turns — counting them here
        // would rebuild the very inflation this split exists to expose.
        read += (u.input_tokens ?? 0) + (u.cache_write_tokens ?? 0)
        written += u.output_tokens ?? 0
      } catch {
        /* a payload written by an older tracer simply contributes nothing */
      }
    }
    return { read, written }
  }

  /**
   * The polling query. Rowid cursor, insertion order, bounded page — the same
   * mechanism serves the live tail and lazy-paged history.
   */
  events(runId: string, after = 0, limit = DEFAULT_LIMIT): EventsPage {
    const cappedLimit = clamp(limit, 1, MAX_LIMIT)
    const events = this.db
      .query<Event, [string, number, number]>(
        `SELECT rowid, event_id, run_id, activity_run_id, parent_id, type, name,
                payload_json, tokens, started_at, ended_at
           FROM events
          WHERE run_id = ? AND rowid > ?
          ORDER BY rowid
          LIMIT ?`,
      )
      .all(runId, Math.max(0, after), cappedLimit)

    return {
      events,
      // `at(-1)` rather than an assertion: the length check already proves a
      // row exists, and a non-null assertion asks a reader to re-prove it.
      cursor: events.at(-1)?.rowid ?? Math.max(0, after),
      has_more: events.length === cappedLimit,
    }
  }

  envelopes(runId: string): Envelope[] {
    return this.db
      .query<Envelope, [string]>(
        `SELECT envelope_id, run_id, activity_run_id, agent, output_type, payload_json,
                valid, created_at
           FROM envelopes WHERE run_id = ? ORDER BY created_at, rowid`,
      )
      .all(runId)
  }

  gates(runId: string): GateResult[] {
    const checks = this.optionalColumn('gate_results', 'checks_json')
    return this.db
      .query<GateResult, [string]>(
        `SELECT id, run_id, activity_run_id, gate, passed, violations_json,
                ${checks}, created_at
           FROM gate_results WHERE run_id = ? ORDER BY id`,
      )
      .all(runId)
  }

  sessionCount(): number {
    const row = this.db
      .query<{ n: number }, []>('SELECT COUNT(*) AS n FROM sessions')
      .get()
    return row?.n ?? 0
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.trunc(value)))
}
