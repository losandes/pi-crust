import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PiCrustDb, resolveDbPath } from "./db.ts";
import {
  fixtureDbPath,
  insertActivityRun,
  insertEvent,
  insertSession,
} from "./trace-db-fixture.test.ts";

/**
 * Issue #24, 1.1.1: `apps/visualizer/server/db.ts:89` is named explicitly as
 * one of the consumers that MUST resolve its configured path the same way
 * every other consumer does (1.1.2) — expand a leading `~`, expand
 * `{primary_worktree}`, use an absolute value unchanged, otherwise resolve
 * against the repository root.
 *
 * `resolveDbPath` now expands `~` the same way (`db.ts`'s own `expandHome`,
 * duplicated from the shared resolver rather than imported — the server and
 * the factory are separate packages). `{primary_worktree}` is deliberately
 * NOT expanded here: that token exists for a value stated in a repository's
 * own `crust.config.yaml`, not for a flag or environment variable a single
 * developer types at a shell, which is all this function ever sees.
 */

const sealed = (
  overrides: Readonly<Record<string, string | undefined>> = {},
): Readonly<Record<string, string | undefined>> => ({
  CRUST_DB: undefined,
  ...overrides,
});

test(
  [
    "given server/db::resolveDbPath",
    "when CRUST_DB starts with ~",
    "it should expand to the user's home directory, same as every other data-path consumer (1.1.1, 1.1.2)",
  ].join(", "),
  () => {
    // given
    const env = sealed({ CRUST_DB: "~/pi-crust-data/crust.db" });

    // when
    const actual = resolveDbPath(["bun", "server"], env);

    // then
    expect(actual).toEqual(join(homedir(), "pi-crust-data", "crust.db"));
  },
);

test(
  [
    "given server/db::resolveDbPath",
    "when --db is given a ~-prefixed value",
    "it should expand it the same way CRUST_DB does, rather than treating ~ as a literal path segment",
  ].join(", "),
  () => {
    // given
    const env = sealed();

    // when
    const actual = resolveDbPath(
      ["bun", "server", "--db", "~/pi-crust-data/crust.db"],
      env,
    );

    // then
    expect(actual).toEqual(join(homedir(), "pi-crust-data", "crust.db"));
  },
);

test(
  [
    "given server/db::resolveDbPath",
    "when the value is a bare ~ with nothing after it",
    "it should resolve to exactly the home directory, not a literal '~' entry inside cwd",
  ].join(", "),
  () => {
    // given
    const env = sealed({ CRUST_DB: "~" });

    // when
    const actual = resolveDbPath(["bun", "server"], env);

    // then
    expect(actual).toEqual(homedir());
  },
);

/**
 * Temporary fixture databases, removed between tests — every test that opens
 * one through `fixtureDbPath()` creates a fresh temporary directory (1.1.5)
 * and tracks it here rather than writing inside the repository.
 */
const created = new Set<string>();
const track = (path: string): string => {
  created.add(path);
  return path;
};

afterEach(() => {
  for (const path of created) {
    rmSync(dirname(path), { recursive: true, force: true });
  }
  created.clear();
});

/** agent_sessions, envelopes and gate_results: raw inserts, each used by one test. */
const insertAgentSession = (
  dbPath: string,
  row: Readonly<{
    run_id: string;
    agent: string;
    coding_agent?: string | null;
    model?: string | null;
    session_id?: string | null;
    color?: string | null;
    context_tokens?: number | null;
    context_window?: number | null;
    created_at?: string | null;
    last_used_at?: string | null;
  }>,
): void => {
  const db = new Database(dbPath);
  db.run(
    "INSERT INTO agent_sessions (run_id, agent, coding_agent, model, session_id, color, " +
      "context_tokens, context_window, created_at, last_used_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [
      row.run_id,
      row.agent,
      row.coding_agent ?? null,
      row.model ?? null,
      row.session_id ?? null,
      row.color ?? null,
      row.context_tokens ?? null,
      row.context_window ?? null,
      row.created_at ?? null,
      row.last_used_at ?? null,
    ],
  );
  db.close();
};

const insertEnvelope = (
  dbPath: string,
  row: Readonly<{
    envelope_id: string;
    run_id: string;
    activity_run_id?: string | null;
    agent?: string | null;
    output_type?: string | null;
    payload_json?: string | null;
    valid?: number | null;
    created_at?: string | null;
  }>,
): void => {
  const db = new Database(dbPath);
  db.run(
    "INSERT INTO envelopes (envelope_id, run_id, activity_run_id, agent, output_type, " +
      "payload_json, valid, created_at) VALUES (?,?,?,?,?,?,?,?)",
    [
      row.envelope_id,
      row.run_id,
      row.activity_run_id ?? null,
      row.agent ?? null,
      row.output_type ?? null,
      row.payload_json ?? null,
      row.valid ?? null,
      row.created_at ?? null,
    ],
  );
  db.close();
};

const insertGateResult = (
  dbPath: string,
  row: Readonly<{
    run_id: string;
    activity_run_id?: string | null;
    gate?: string | null;
    passed?: number | null;
    violations_json?: string | null;
    checks_json?: string | null;
    created_at?: string | null;
  }>,
): void => {
  const db = new Database(dbPath);
  db.run(
    "INSERT INTO gate_results (run_id, activity_run_id, gate, passed, violations_json, " +
      "checks_json, created_at) VALUES (?,?,?,?,?,?,?)",
    [
      row.run_id,
      row.activity_run_id ?? null,
      row.gate ?? null,
      row.passed ?? null,
      row.violations_json ?? null,
      row.checks_json ?? null,
      row.created_at ?? null,
    ],
  );
  db.close();
};

const insertAgentEndEvent = (
  dbPath: string,
  runId: string,
  payloadJson: string | null,
): void => insertEvent(dbPath, { event_id: `evt_${Math.random()}`, run_id: runId, type: "agent_end", payload_json: payloadJson });

test(
  [
    "given server/db::PiCrustDb.usage",
    "when an agent_end payload carries input and cache-write tokens",
    "it should count them as read and the output tokens as written (1.2.1)",
  ].join(", "),
  () => {
    // given
    const path = track(fixtureDbPath());
    insertSession(path, { run_id: "r1" });
    insertAgentEndEvent(
      path,
      "r1",
      JSON.stringify({ usage: { input_tokens: 10, cache_write_tokens: 5, output_tokens: 7 } }),
    );
    const db = new PiCrustDb(path);

    // when
    const actual = db.usage("r1");

    // then
    expect(actual).toEqual({ read: 15, written: 7 });
  },
);

test(
  [
    "given server/db::PiCrustDb.usage",
    "when a payload's JSON does not parse",
    "it should contribute nothing rather than throw (1.2.1)",
  ].join(", "),
  () => {
    // given
    const path = track(fixtureDbPath());
    insertSession(path, { run_id: "r1" });
    insertAgentEndEvent(path, "r1", "{not json");
    const db = new PiCrustDb(path);

    // when
    const actual = db.usage("r1");

    // then
    expect(actual).toEqual({ read: 0, written: 0 });
  },
);

test(
  [
    "given server/db::PiCrustDb.usage",
    "when a payload carries no usage key",
    "it should be skipped (1.2.1)",
  ].join(", "),
  () => {
    // given
    const path = track(fixtureDbPath());
    insertSession(path, { run_id: "r1" });
    insertAgentEndEvent(path, "r1", JSON.stringify({ model: "sonnet" }));
    const db = new PiCrustDb(path);

    // when
    const actual = db.usage("r1");

    // then
    expect(actual).toEqual({ read: 0, written: 0 });
  },
);

test(
  [
    "given server/db::PiCrustDb.setArchived",
    "when a session is archived and then restored",
    "it should flip the column both ways and read back each time (1.2.2)",
  ].join(", "),
  () => {
    // given
    const path = track(fixtureDbPath());
    insertSession(path, { run_id: "r1" });
    const db = new PiCrustDb(path);

    // when
    const archived = db.setArchived("r1", true);
    const afterArchive = db.session("r1");
    const restored = db.setArchived("r1", false);
    const afterRestore = db.session("r1");

    // then
    expect(archived).toBe(true);
    expect(afterArchive?.archived).toBe(1);
    expect(restored).toBe(true);
    expect(afterRestore?.archived).toBe(0);
  },
);

test(
  [
    "given server/db::PiCrustDb.setArchived",
    "when the run id does not exist",
    "it should return false (1.2.2)",
  ].join(", "),
  () => {
    // given
    const path = track(fixtureDbPath());
    const db = new PiCrustDb(path);

    // when
    const actual = db.setArchived("does-not-exist", true);

    // then
    expect(actual).toBe(false);
  },
);

test(
  [
    "given server/db::PiCrustDb.setArchived",
    "when the database predates the archived column",
    "it should throw the stated error (1.2.2)",
  ].join(", "),
  () => {
    // given — a sessions table built without `archived`, as an older tracer left it
    const dir = mkdtempSync(join(tmpdir(), "crust-no-archived-"));
    const path = track(join(dir, "crust.db"));
    const raw = new Database(path, { create: true });
    raw.run(
      "CREATE TABLE sessions (run_id TEXT PRIMARY KEY, status TEXT, started_at TEXT, ended_at TEXT)",
    );
    raw.run("INSERT INTO sessions (run_id, status) VALUES ('r1', 'success')");
    raw.close();
    const db = new PiCrustDb(path);

    // when / then
    expect(() => db.setArchived("r1", true)).toThrow(
      "this db predates the archived column — run any lifecycle once to migrate it",
    );
  },
);

test(
  [
    "given server/db::PiCrustDb",
    "when sessions, activityRuns and agents exist for a run",
    "it should read each back through its own method and through the combined ones (1.2.3)",
  ].join(", "),
  () => {
    // given
    const path = track(fixtureDbPath());
    insertSession(path, {
      run_id: "r1",
      status: "success",
      request: "add a /health endpoint",
      engineer: "alice",
      archived: 0,
    });
    insertSession(path, { run_id: "r2", status: "success", archived: 1 });
    insertActivityRun(path, {
      activity_run_id: "ar1",
      run_id: "r1",
      seq: 1,
      name: "plan",
      kind: "agent",
      owner: "architect",
      status: "success",
    });
    insertAgentSession(path, {
      run_id: "r1",
      agent: "architect",
      model: "sonnet",
      session_id: "sess-1",
      color: "#a78bfa",
    });
    insertEvent(path, {
      event_id: "evt1",
      run_id: "r1",
      activity_run_id: "ar1",
      type: "agent_start",
      payload_json: JSON.stringify({ model: "opus", session_id: "sess-2", color: "#fff" }),
      started_at: "2024-01-01T00:00:00Z",
    });
    const db = new PiCrustDb(path, "my-workspace");

    // when
    const session = db.session("r1");
    const activityRuns = db.activityRuns("r1");
    const agents = db.agentSessions("r1");
    const sessions = db.sessions();
    const sessionDetail = db.sessionDetail("r1");
    const count = db.sessionCount();

    // then
    expect(session?.run_id).toBe("r1");
    expect(session?.workspace).toBe("my-workspace");
    expect(activityRuns).toHaveLength(1);
    expect(activityRuns[0]?.name).toBe("plan");
    // the completed agent_sessions row wins over the started-but-unfinished fallback
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({ agent: "architect", model: "sonnet" });
    // r2 is archived, so the default (unarchived-only) listing omits it
    expect(sessions.map((s) => s.run_id)).toEqual(["r1"]);
    expect(sessions[0]?.activityRuns).toHaveLength(1);
    expect(sessionDetail?.session.run_id).toBe("r1");
    expect(sessionDetail?.activityRuns).toHaveLength(1);
    expect(sessionDetail?.agents).toHaveLength(1);
    expect(count).toBe(2);
  },
);

test(
  [
    "given server/db::PiCrustDb.sessions",
    "when includeArchived is true",
    "it should include archived sessions too (1.2.3)",
  ].join(", "),
  () => {
    // given
    const path = track(fixtureDbPath());
    insertSession(path, { run_id: "r1", archived: 1 });
    const db = new PiCrustDb(path);

    // when
    const actual = db.sessions(200, true);

    // then
    expect(actual.map((s) => s.run_id)).toEqual(["r1"]);
  },
);

test(
  [
    "given server/db::PiCrustDb.agentSessions",
    "when an agent has started but has no agent_sessions row yet",
    "it should fall back to the agent_start event's payload (1.2.3)",
  ].join(", "),
  () => {
    // given
    const path = track(fixtureDbPath());
    insertSession(path, { run_id: "r1" });
    insertActivityRun(path, { activity_run_id: "ar1", run_id: "r1", owner: "builder" });
    insertEvent(path, {
      event_id: "evt1",
      run_id: "r1",
      activity_run_id: "ar1",
      type: "agent_start",
      payload_json: JSON.stringify({ model: "opus", session_id: "sess-live", color: "#000" }),
      started_at: "2024-01-01T00:00:00Z",
    });
    const db = new PiCrustDb(path);

    // when
    const actual = db.agentSessions("r1");

    // then
    expect(actual).toHaveLength(1);
    expect(actual[0]).toMatchObject({
      run_id: "r1",
      agent: "builder",
      model: "opus",
      session_id: "sess-live",
      color: "#000",
    });
  },
);

test(
  [
    "given server/db::PiCrustDb.agentSessions",
    "when an agent_start event has no owner on its activity_run",
    "it should be skipped (1.2.3)",
  ].join(", "),
  () => {
    // given
    const path = track(fixtureDbPath());
    insertSession(path, { run_id: "r1" });
    insertActivityRun(path, { activity_run_id: "ar1", run_id: "r1", owner: null });
    insertEvent(path, {
      event_id: "evt1",
      run_id: "r1",
      activity_run_id: "ar1",
      type: "agent_start",
      payload_json: "{not json",
      started_at: "2024-01-01T00:00:00Z",
    });
    const db = new PiCrustDb(path);

    // when
    const actual = db.agentSessions("r1");

    // then
    expect(actual).toHaveLength(0);
  },
);

test(
  [
    "given server/db::PiCrustDb.events",
    "when a page boundary is reached",
    "it should report has_more and a cursor past the last row (1.2.3)",
  ].join(", "),
  () => {
    // given
    const path = track(fixtureDbPath());
    insertSession(path, { run_id: "r1" });
    insertEvent(path, { event_id: "evt1", run_id: "r1", type: "log", name: "first" });
    insertEvent(path, { event_id: "evt2", run_id: "r1", type: "log", name: "second" });
    const db = new PiCrustDb(path);

    // when
    const page = db.events("r1", 0, 1);

    // then
    expect(page.events).toHaveLength(1);
    expect(page.events[0]?.name).toBe("first");
    expect(page.has_more).toBe(true);
    expect(page.cursor).toBe(page.events[0]?.rowid);
  },
);

test(
  [
    "given server/db::PiCrustDb.events",
    "when there is no more after the given cursor",
    "it should report has_more false and echo the given cursor back (1.2.3)",
  ].join(", "),
  () => {
    // given
    const path = track(fixtureDbPath());
    insertSession(path, { run_id: "r1" });
    const db = new PiCrustDb(path);

    // when
    const page = db.events("r1", 5);

    // then
    expect(page.events).toHaveLength(0);
    expect(page.has_more).toBe(false);
    expect(page.cursor).toBe(5);
  },
);

test(
  [
    "given server/db::PiCrustDb.envelopes",
    "when an envelope was recorded for a run",
    "it should be read back in creation order (1.2.3)",
  ].join(", "),
  () => {
    // given
    const path = track(fixtureDbPath());
    insertSession(path, { run_id: "r1" });
    insertEnvelope(path, {
      envelope_id: "env1",
      run_id: "r1",
      agent: "architect",
      output_type: "TPlan",
      payload_json: "{}",
      valid: 1,
      created_at: "2024-01-01T00:00:00Z",
    });
    const db = new PiCrustDb(path);

    // when
    const actual = db.envelopes("r1");

    // then
    expect(actual).toHaveLength(1);
    expect(actual[0]?.envelope_id).toBe("env1");
  },
);

test(
  [
    "given server/db::PiCrustDb.gates",
    "when a gate result was recorded for a run",
    "it should be read back with its checks (1.2.3)",
  ].join(", "),
  () => {
    // given
    const path = track(fixtureDbPath());
    insertSession(path, { run_id: "r1" });
    insertGateResult(path, {
      run_id: "r1",
      gate: "default",
      passed: 1,
      violations_json: "[]",
      checks_json: JSON.stringify([{ item: "tests pass", ok: true, note: "" }]),
      created_at: "2024-01-01T00:00:00Z",
    });
    const db = new PiCrustDb(path);

    // when
    const actual = db.gates("r1");

    // then
    expect(actual).toHaveLength(1);
    expect(actual[0]?.gate).toBe("default");
    expect(actual[0]?.checks_json).toContain("tests pass");
  },
);

test(
  [
    "given server/db::PiCrustDb",
    "when constructed against a path with no database file",
    "it should throw rather than open one that does not exist",
  ].join(", "),
  () => {
    // given
    const dir = mkdtempSync(join(tmpdir(), "crust-missing-"));
    const path = track(join(dir, "crust.db"));

    // when / then
    expect(() => new PiCrustDb(path)).toThrow(/crust\.db not found/);
  },
);

test(
  [
    "given server/db::PiCrustDb.close",
    "when called after an archive has opened the writer connection",
    "it should close both connections without throwing",
  ].join(", "),
  () => {
    // given
    const path = track(fixtureDbPath());
    insertSession(path, { run_id: "r1" });
    const db = new PiCrustDb(path);
    db.setArchived("r1", true);

    // when / then
    expect(() => db.close()).not.toThrow();
  },
);
