import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceRegistry } from "./registry.ts";
import type { TWorkspace } from "./workspaces.ts";
import { workspaceRootOf } from "./workspaces.ts";

/**
 * A working tree holding a real trace database.
 *
 * Built with the tracer's own schema rather than a fixture, so a column the
 * factory adds and the server reads cannot drift apart unnoticed.
 */
const tree = (
  name: string,
  runs: ReadonlyArray<readonly [string, string]>,
): TWorkspace => {
  const root = join(mkdtempSync(join(tmpdir(), "crust-registry-")), name);
  const dbPath = join(root, ".pi-crust", "data", "crust.db");
  mkdirSync(join(root, ".pi-crust", "data"), { recursive: true });
  const db = new Database(dbPath, { create: true });
  db.run("PRAGMA journal_mode=WAL;");
  db.run(
    "CREATE TABLE sessions (run_id TEXT PRIMARY KEY, lifecycle TEXT, request TEXT," +
      " status TEXT, engineer TEXT, started_at TEXT, ended_at TEXT," +
      " total_tokens INTEGER, total_cost REAL, archived INTEGER DEFAULT 0," +
      " workspace_root TEXT, branch TEXT)",
  );
  db.run("CREATE TABLE activity_runs (activity_run_id TEXT PRIMARY KEY, run_id TEXT, seq INTEGER," +
    " name TEXT, kind TEXT, owner TEXT, description TEXT, status TEXT," +
    " error TEXT, started_at TEXT, ended_at TEXT)");
  db.run("CREATE TABLE events (event_id TEXT PRIMARY KEY, run_id TEXT, activity_run_id TEXT," +
    " parent_id TEXT, type TEXT, name TEXT, payload_json TEXT, tokens INTEGER," +
    " started_at TEXT, ended_at TEXT)");
  db.run("CREATE TABLE agent_sessions (run_id TEXT, agent TEXT, coding_agent TEXT," +
    " model TEXT, color TEXT, session_id TEXT, context_tokens INTEGER," +
    " context_window INTEGER, created_at TEXT, last_used_at TEXT)");
  for (const [runId, startedAt] of runs) {
    db.run("INSERT INTO sessions (run_id, started_at, status) VALUES (?,?,'ok')", [
      runId,
      startedAt,
    ]);
  }
  db.close();
  return { label: name, dbPath, root };
};

test(
  [
    "given server/registry::WorkspaceRegistry.sessions",
    "when several trees each hold runs",
    "it should merge them newest first and say which tree each came from",
  ].join(", "),
  () => {
    // given — the whole point: five agents in five worktrees, one list
    const registry = new WorkspaceRegistry([
      tree("alpha", [
        ["aaaa1111", "2026-10-06T09:00:00Z"],
        ["aaaa2222", "2026-10-06T11:00:00Z"],
      ]),
      tree("beta", [["bbbb1111", "2026-10-06T10:00:00Z"]]),
    ]);

    // when
    const actual = registry.sessions();

    // then
    expect(
      actual.map((session) => [session.run_id, session.workspace]),
    ).toEqual([
      ["aaaa2222", "alpha"],
      ["bbbb1111", "beta"],
      ["aaaa1111", "alpha"],
    ]);
    registry.close();
  },
);

test(
  [
    "given server/registry::WorkspaceRegistry.sessions",
    "when a watched tree has no database yet",
    "it should serve the others and report the gap rather than fail",
  ].join(", "),
  () => {
    // given — a worktree created this morning has no trace until its first
    // run, which is the normal state of a fresh tree, not an error
    const present = tree("present", [["cccc1111", "2026-10-06T09:00:00Z"]]);
    const registry = new WorkspaceRegistry([
      present,
      { label: "empty", dbPath: "/nowhere/.pi-crust/data/crust.db", root: "/nowhere" },
    ]);

    // when
    const sessions = registry.sessions();
    const states = registry.states();

    // then
    expect(sessions.map((session) => session.run_id)).toEqual(["cccc1111"]);
    expect(states.map((state) => [state.label, state.db !== undefined])).toEqual([
      ["present", true],
      ["empty", false],
    ]);
    expect(states[1]?.error).toContain("crust.db not found");
    registry.close();
  },
);

test(
  [
    "given server/registry::WorkspaceRegistry.connect",
    "when a tree gains its database after the server started",
    "it should pick it up rather than stay empty for the process lifetime",
  ].join(", "),
  () => {
    // given — deciding reachability once at startup is the bug this prevents
    const late = join(mkdtempSync(join(tmpdir(), "crust-registry-late-")), "late");
    const dbPath = join(late, ".pi-crust", "data", "crust.db");
    const registry = new WorkspaceRegistry([{ label: "late", dbPath, root: late }]);
    expect(registry.sessions()).toEqual([]);

    // when — the tree's first run creates the trace
    const created = tree("late", [["dddd1111", "2026-10-06T09:00:00Z"]]);
    const live = new WorkspaceRegistry([
      { label: "late", dbPath: created.dbPath, root: created.root },
    ]);

    // then
    expect(live.sessions().map((session) => session.run_id)).toEqual(["dddd1111"]);
    registry.close();
    live.close();
    rmSync(late, { recursive: true, force: true });
  },
);

test(
  [
    "given server/registry::WorkspaceRegistry.resolve",
    "when a request names a workspace that does not hold the run",
    "it should refuse rather than answer from a different tree",
  ].join(", "),
  () => {
    // given — two trees could in principle mint the same run id, and silently
    // answering from the wrong one would hide a bad link instead of showing it
    const registry = new WorkspaceRegistry([
      tree("one", [["eeee1111", "2026-10-06T09:00:00Z"]]),
      tree("two", [["ffff1111", "2026-10-06T09:00:00Z"]]),
    ]);

    // when
    const named = registry.resolve("eeee1111", "one");
    const mismatched = registry.resolve("eeee1111", "two");
    const unnamed = registry.resolve("ffff1111", undefined);
    const unknown = registry.resolve("99999999", undefined);

    // then
    expect(named?.label).toEqual("one");
    expect(mismatched).toBeUndefined();
    expect(unnamed?.label).toEqual("two");
    expect(unknown).toBeUndefined();
    registry.close();
  },
);

test(
  [
    "given server/registry::WorkspaceRegistry.states",
    "when a tree's database file is deleted after the registry opened it",
    "it should evict the cached connection and report the workspace as unavailable",
  ].join(", "),
  () => {
    // given — a worktree removed out from under an already-open connection,
    // which is exactly the shape a deleted git worktree leaves behind
    const vanishing = tree("vanishing", [["dddd1111", "2026-10-06T09:00:00Z"]]);
    const registry = new WorkspaceRegistry([vanishing]);
    const opened = registry.states();
    expect(opened.map((state) => state.db !== undefined)).toEqual([true]);

    // when — the file goes away, and the registry is asked again
    unlinkSync(vanishing.dbPath);
    const actual = registry.states();

    // then — reported as unavailable, not thrown, and not served from a stale
    // cached connection
    expect(actual.map((state) => [state.label, state.db !== undefined, state.error])).toEqual([
      ["vanishing", false, "workspace is gone"],
    ]);
    registry.close();
  },
);

test(
  [
    "given server/registry::WorkspaceRegistry.states",
    "when a workspace's database does not sit two levels below its root",
    "it should report the carried root, not one recomputed from the db path",
  ].join(", "),
  () => {
    // given \u2014 a pooled store, which is the shape that breaks a recomputed
    // root: two levels above `<clone>/.pi-crust/data/issues/41/crust.db` is
    // `<clone>/.pi-crust/data`, not the clone itself
    const pooled = tree("pooled", [["gggg1111", "2026-10-06T09:00:00Z"]]);
    const carriedRoot = join(pooled.root, "..", "clone");
    const registry = new WorkspaceRegistry([
      { label: "pooled", dbPath: pooled.dbPath, root: carriedRoot },
    ]);

    // when
    const actual = registry.states();

    // then
    expect(actual[0]?.root).toEqual(carriedRoot);
    expect(actual[0]?.root).not.toEqual(workspaceRootOf(pooled.dbPath));
    registry.close();
  },
);
