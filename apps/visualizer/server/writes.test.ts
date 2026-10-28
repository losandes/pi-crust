import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { crustRuntime, NO_RUNTIME, postMessage, resumeRun, sessionDir, startRun, startSteer } from "./writes.ts";

/**
 * A stamped tree, as an install leaves one: config, data, and NO runtime.
 *
 * The runtime ships with the package, so a server that resolves an entry
 * point relative to the repository resolves it to nothing — which is what
 * every write action in this UI was doing.
 */
const stampedTree = (home?: string): string => {
  const root = mkdtempSync(join(tmpdir(), "crust-writes-"));
  mkdirSync(join(root, ".pi-crust", "data"), { recursive: true });
  if (home !== undefined) {
    writeFileSync(join(root, ".pi-crust", "data", "pi-crust-home"), home);
  }
  return root;
};

/** A package, as an install reads one: `runtime/cli.ts` is what proves it. */
const packageTree = (): string => {
  const home = mkdtempSync(join(tmpdir(), "crust-home-"));
  mkdirSync(join(home, "runtime", "lifecycles"), { recursive: true });
  writeFileSync(join(home, "runtime", "cli.ts"), "");
  return home;
};

const dbOf = (root: string): string =>
  join(root, ".pi-crust", "data", "crust.db");

/**
 * Parses `inbox.jsonl` exactly as `runtime/modules/data/inbox.ts::readInbox`
 * does: skip a blank line, drop anything whose `kind` is not one this
 * run understands. There is no import across this boundary (see the
 * `resumeRun`/`developerNote` pin below for why), so this side pins the
 * wire format it writes with the same tolerance the runtime reader applies.
 */
const readInboxLikeTheRuntimeDoes = (
  path: string,
): readonly Readonly<{ kind: string; message: string; from: string }>[] => {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .flatMap((line) => {
      const parsed = JSON.parse(line) as Partial<{
        kind: unknown;
        message: unknown;
        from: unknown;
      }>;
      if (!["steer", "follow_up", "abort"].includes(parsed.kind as string)) return [];
      return [
        {
          kind: parsed.kind as string,
          message: typeof parsed.message === "string" ? parsed.message : "",
          from: typeof parsed.from === "string" ? parsed.from : "unknown",
        },
      ];
    });
};

/** The one table `resumeRun`'s note-recording touches, as a real trace db has it. */
const withEventsTable = (dbPath: string): string => {
  mkdirSync(join(dbPath, ".."), { recursive: true });
  const db = new Database(dbPath, { create: true });
  db.run(
    "CREATE TABLE IF NOT EXISTS events (event_id TEXT PRIMARY KEY, run_id TEXT, " +
      "activity_run_id TEXT, type TEXT, name TEXT, payload_json TEXT, started_at TEXT)",
  );
  db.close();
  return dbPath;
};

/**
 * Temporary trees, removed between tests.
 *
 * A Set rather than an array being pushed into: what this holds is a set of
 * paths to delete, and emptying it is one operation rather than a splice.
 */
const created = new Set<string>();
const track = (path: string): string => {
  created.add(path);
  return path;
};

/** The environment, passed rather than mutated — the whole point of the parameter. */
const withHome = (home?: string): Readonly<Record<string, string | undefined>> =>
  home === undefined ? {} : { CRUST_HOME: home };

afterEach(() => {
  for (const path of created) {
    rmSync(path, { recursive: true, force: true });
  }
  created.clear();
});

test(
  [
    "given server/writes::crustRuntime",
    "when the stamp recorded where pi-crust was installed from",
    "it should resolve the runtime there rather than inside the repository",
  ].join(", "),
  () => {
    // given
    const home = track(packageTree());
    const root = track(stampedTree(home));

    // when
    const actual = crustRuntime(dbOf(root), withHome());

    // then
    expect(actual).toBe(join(home, "runtime"));
  },
);

test(
  [
    "given server/writes::crustRuntime",
    "when CRUST_HOME is set",
    "it should win, because that is the repair when the package moves",
  ].join(", "),
  () => {
    // given
    const home = track(packageTree());
    const root = track(stampedTree("/gone/stale/path"));

    // when
    const actual = crustRuntime(dbOf(root), withHome(home));

    // then
    expect(actual).toBe(join(home, "runtime"));
  },
);

test(
  [
    "given server/writes::crustRuntime",
    "when nothing says where pi-crust is",
    "it should be undefined rather than a path that cannot exist",
  ].join(", "),
  () => {
    // given
    const root = track(stampedTree());

    // when
    const actual = crustRuntime(dbOf(root), withHome());

    // then
    expect(actual).toBeUndefined();
  },
);

test(
  [
    "given server/writes::startSteer",
    "when the runtime cannot be found",
    "it should refuse and say so, rather than report a steer that never ran",
  ].join(", "),
  () => {
    // given — a pid proves a process started, not that it found its module
    const root = track(stampedTree());

    // when
    const actual = startSteer(dbOf(root), "a1b2c3d4", "plan", "overwrite", "x");

    // then
    expect(actual.started).toBe(false);
    expect(actual.pid).toBeUndefined();
    expect(actual.reason).toBe(NO_RUNTIME);
  },
);

test(
  [
    "given server/writes::startRun",
    "when the runtime cannot be found",
    "it should hand back no run id, so nothing is told to watch for one",
  ].join(", "),
  () => {
    // given
    const root = track(stampedTree());

    // when
    const actual = startRun(dbOf(root), "sdlc", "add a /health endpoint", []);

    // then
    expect(actual.run_id).toBe("");
    expect(actual.reason).toBe(NO_RUNTIME);
  },
);

test(
  [
    "given server/writes::startSteer",
    "when the target is branch and a minted id is given",
    "it should return that id in branch_run_id",
  ].join(", "),
  () => {
    // given — the server mints the id because a branch detaches, and the
    // response cannot wait to learn what the child decided
    const root = track(stampedTree());

    // when
    const actual = startSteer(
      dbOf(root),
      "a1b2c3d4",
      "plan",
      "branch",
      "try again",
      "deadbeef",
    );

    // then — the runtime is not found in this stamp, but the id is still echoed
    expect(actual.branch_run_id).toBe("deadbeef");
  },
);

test(
  [
    "given server/writes::startSteer",
    "when the target is overwrite",
    "it should carry no branch_run_id at all",
  ].join(", "),
  () => {
    // given
    const root = track(stampedTree());

    // when
    const actual = startSteer(dbOf(root), "a1b2c3d4", "plan", "overwrite", "x", "deadbeef");

    // then
    expect(actual.branch_run_id).toBe("");
  },
);

test(
  [
    "given server/writes::postMessage",
    "when a steer message is posted through the web app's write endpoint",
    "it should be deliverable by the runtime's own inboxSince, the mechanism execute-agent.ts polls to steer a running agent",
  ].join(", "),
  () => {
    // given: this is the one shared surface a web app and a running pi
    // process both have: no socket, no import across the skill boundary,
    // just the file both sides append to and read in the same shape.
    const root = track(stampedTree());

    // when
    postMessage(dbOf(root), "a1b2c3d4", "steer", "stop and check the registry", "alice");
    const path = join(sessionDir(dbOf(root), "a1b2c3d4"), "inbox.jsonl");
    const actual = readInboxLikeTheRuntimeDoes(path);

    // then: a message typed into the dialog that the runtime cannot parse
    // is a message that was never received, which is the exact regression
    // this proves does not recur
    expect(actual).toHaveLength(1);
    expect(actual[0]).toMatchObject({
      kind: "steer",
      message: "stop and check the registry",
      from: "alice",
    });
  },
);

test(
  [
    "given server/writes::postMessage",
    "when a follow_up is posted after a steer",
    "it should keep both, in the order they were sent",
  ].join(", "),
  () => {
    // given
    const root = track(stampedTree());

    // when
    postMessage(dbOf(root), "a1b2c3d4", "steer", "use the existing table", "alice");
    postMessage(dbOf(root), "a1b2c3d4", "follow_up", "then write it up", "alice");
    const path = join(sessionDir(dbOf(root), "a1b2c3d4"), "inbox.jsonl");
    const actual = readInboxLikeTheRuntimeDoes(path);

    // then
    expect(actual.map((entry) => entry.kind)).toEqual(["steer", "follow_up"]);
    expect(actual.map((entry) => entry.message)).toEqual([
      "use the existing table",
      "then write it up",
    ]);
  },
);

test(
  [
    "given server/writes::resumeRun",
    "when a note is given and steering.md already has earlier content",
    "it should append the note and leave what was there",
  ].join(", "),
  () => {
    // given
    const root = track(stampedTree());
    const handoffDir = join(root, ".pi-crust", "data", "sessions", "a1b2c3d4", "context_handoff");
    mkdirSync(handoffDir, { recursive: true });
    writeFileSync(join(handoffDir, "steering.md"), "## earlier entry\n\nfrom before\n");
    withEventsTable(dbOf(root));

    // when
    const actual = resumeRun(dbOf(root), "a1b2c3d4", "I fixed the migration");

    // then
    const text = readFileSync(join(handoffDir, "steering.md"), "utf8");
    expect(text).toContain("from before");
    expect(text).toContain("## Instruction from the developer at");
    expect(text).toContain("I fixed the migration");
    expect(actual.note_recorded).toBe(join(handoffDir, "steering.md"));
  },
);

test(
  [
    "given server/writes::resumeRun",
    "when no note is given",
    "it should write no steering.md at all",
  ].join(", "),
  () => {
    // given
    const root = track(stampedTree());
    const handoffDir = join(root, ".pi-crust", "data", "sessions", "a1b2c3d4", "context_handoff");

    // when
    const actual = resumeRun(dbOf(root), "a1b2c3d4");

    // then
    expect(existsSync(join(handoffDir, "steering.md"))).toBe(false);
    expect(actual.note_recorded).toBe("");
  },
);

test(
  [
    "given server/writes::resumeRun",
    "the steering-entry heading it writes",
    "must match runtime/modules/use-cases/steer.ts::developerNote exactly",
  ].join(", "),
  () => {
    // given — there is no import across this boundary: this server resolves
    // whatever workspace it is pointed at, and runtime/ ships with the
    // package rather than with the stamp, so both sides duplicate the
    // format and each pins it with a test. This is this side's pin.
    const root = track(stampedTree());
    const handoffDir = join(root, ".pi-crust", "data", "sessions", "a1b2c3d4", "context_handoff");
    withEventsTable(dbOf(root));

    // when
    resumeRun(dbOf(root), "a1b2c3d4", "smoke test note");

    // then
    const text = readFileSync(join(handoffDir, "steering.md"), "utf8");
    expect(text).toMatch(/^## Instruction from the developer at .+\n\nsmoke test note\n/);
  },
);
