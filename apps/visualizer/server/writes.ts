/**
 * Everything this server can CHANGE, and the one gate in front of all of it.
 *
 * Reads are harmless: a trace is a record of what already happened. Writes are
 * not — they steer a running agent, answer a gate on your behalf, and start
 * runs that spend money. So they live in one file with one guard, rather than
 * being sprinkled through the route table where the next one added quietly
 * misses the check.
 *
 * ## Why the token is unconditional
 *
 * It would be convenient to skip it for localhost. It would also be wrong:
 * "the connection came from 127.0.0.1" is not an identity. Any page in any
 * browser on this machine can POST to localhost, and anything that can make
 * the server fetch a URL makes the loopback check meaningless. The cost of
 * being right is one header.
 *
 * Fail CLOSED: with no `CRUST_TOKEN` set, every write is refused. A server
 * that silently allowed writes because nobody configured a secret is the
 * failure this is here to prevent.
 */

import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ApiError } from "../shared/types.ts";

export const TOKEN_HEADER = "x-crust-token";

/** A run id is a path segment on disk; anything else is an attack or a typo. */
export const isSafeSegment = (value: string): boolean =>
  /^[A-Za-z0-9_-]+$/.test(value) && value.length <= 64;

const json = (data: unknown, status: number): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

/**
 * Compare without leaking the answer in how long it took.
 *
 * Overkill for a local dashboard, and cheap enough that arguing about it costs
 * more than doing it.
 */
const sameSecret = (given: string, expected: string): boolean => {
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let index = 0; index < given.length; index += 1) {
    diff |= given.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return diff === 0;
};

/** Undefined when the caller may write; a Response saying why when they may not. */
export const refuseUnlessAuthorised = (req: Request): Response | undefined => {
  const expected = (process.env.CRUST_TOKEN ?? "").trim();
  if (expected === "") {
    return json(
      {
        error:
          "writes are disabled: set CRUST_TOKEN on the server and send it as " +
          `the ${TOKEN_HEADER} header`,
      } satisfies ApiError,
      503,
    );
  }
  const given = (req.headers.get(TOKEN_HEADER) ?? "").trim();
  return sameSecret(given, expected)
    ? undefined
    : json({ error: "unauthorised" } satisfies ApiError, 401);
};

/**
 * The workspace this server is reporting on.
 *
 * Derived from the database it was pointed at — `<workspace>/.pi-crust/data/
 * crust.db` — rather than from its own cwd, which is the visualizer's
 * directory inside the skill and not the repository being worked on.
 */
export const workspaceRoot = (dbPath: string): string =>
  resolve(dirname(dbPath), "..", "..");

export const sessionDir = (dbPath: string, runId: string): string =>
  join(dirname(dbPath), "sessions", runId);

/**
 * Where the pi-crust runtime is, for the commands this server spawns.
 *
 * The runtime ships with the package and is NOT stamped into a repository:
 * `.pi-crust/` holds `config/`, `data/` and `prompt-engineering/`, and an
 * install removes anything else it finds there. So every entry point this
 * server starts has to be resolved the way the recipes resolve it —
 * `CRUST_HOME`, else the path the installer wrote into the stamp.
 *
 * This is the defect that made every write action in the UI do nothing:
 * spawning `.pi-crust/steer.ts` succeeds in getting a pid, the child dies on
 * a missing module, and the response says the instruction went through.
 */
export const crustRuntime = (
  dbPath: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined => {
  const configured = (env.CRUST_HOME ?? "").trim();
  const home =
    configured === "" ? readHomeFile(workspaceRoot(dbPath)) : configured;
  if (home === undefined) return undefined;
  const runtime = join(home, "runtime");

  return existsSync(join(runtime, "cli.ts")) ? runtime : undefined;
};

const readHomeFile = (root: string): string | undefined => {
  const path = join(root, ".pi-crust", "data", "pi-crust-home");
  if (!existsSync(path)) return undefined;
  const recorded = readFileSync(path, "utf8").trim();

  return recorded === "" ? undefined : recorded;
};

/**
 * What to say when the runtime cannot be found, in the words the recipes use.
 *
 * Named here so steer, consult and start-a-run all refuse identically: the
 * repair is the same one in every case, and three phrasings of it would read
 * as three different problems.
 */
export const NO_RUNTIME =
  "cannot find pi-crust: no CRUST_HOME, and no .pi-crust/data/pi-crust-home " +
  "in this tree. Re-run its installer from the repository, or set CRUST_HOME " +
  "to the package.";

/**
 * Why a run that was started has no session row.
 *
 * A run can be REFUSED before it opens a session: a concurrent Stage whose
 * Activities declare overlapping `writes` is rejected at load, and so is an
 * unknown Activity name. The process exits 2 having written the reason to the
 * session's spawn log, and nothing in the trace records that it ever existed.
 *
 * Read from the log rather than inferred, because the reason is the whole
 * value: "refused" tells a reader nothing they cannot see from the absence.
 */
export const startupFailure = (
  dbPath: string,
  runId: string,
): string | undefined => {
  const logs = ["spawn.log", "resume.log"]
    .map((name) => join(sessionDir(dbPath, runId), name))
    .filter((path) => existsSync(path));
  const text = logs
    .map((path) => readFileSync(path, "utf8").trim())
    .filter((contents) => contents !== "")
    .join("\n");

  return text === "" ? undefined : text.split("\n").slice(-12).join("\n");
};

export type TInboxKind = "steer" | "follow_up" | "abort";

const KINDS: readonly string[] = ["steer", "follow_up", "abort"];

/**
 * Post a message to a running agent's inbox.
 *
 * The same append-only file the factory's own `inbox.ts` reads, written in the
 * same shape. Two implementations of one format is a real risk, and the
 * alternative — importing across the skill boundary into a stamped tree whose
 * path this process cannot know — is worse. The format is four fields and a
 * newline, and both sides have tests.
 */
export const postMessage = (
  dbPath: string,
  runId: string,
  kind: TInboxKind,
  message: string,
  from: string,
): Readonly<{ kind: TInboxKind; message: string; at: string; from: string }> => {
  const dir = sessionDir(dbPath, runId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const entry = { kind, message, at: new Date().toISOString(), from };
  appendFileSync(join(dir, "inbox.jsonl"), `${JSON.stringify(entry)}\n`);
  return entry;
};

export const isInboxKind = (value: unknown): value is TInboxKind =>
  typeof value === "string" && KINDS.includes(value);

/**
 * Record a gate decision where the waiting run will find it.
 *
 * Deliberately the same files `decide.ts` writes, because a run must not care
 * which surface answered it.
 */
export const recordDecision = (
  dbPath: string,
  runId: string,
  action: "approve" | "reject" | "answer",
  text: string,
  from: string,
): string => {
  const handoff = join(sessionDir(dbPath, runId), "context_handoff");
  if (!existsSync(handoff)) mkdirSync(handoff, { recursive: true });
  const body =
    action === "approve"
      ? `Approved by ${from}.${text === "" ? "" : `\n\n${text}`}\n`
      : action === "reject"
        ? `Rejected by ${from}.\n\n${text}\n`
        : `${text}\n`;
  const path = join(handoff, "decision-answer.md");
  writeFileSync(path, body, "utf8");
  return path;
};

/**
 * Send a run back to a activity with new instructions.
 *
 * Detached: the replay is the rest of the run, which may be an hour. The
 * target is passed through as the flag the CLI requires rather than a
 * default chosen here — one of the two discards the path being steered away
 * from, and the server is not the place that decides which.
 */
export const startSteer = (
  dbPath: string,
  runId: string,
  activity: string,
  target: "overwrite" | "branch",
  note: string,
): Readonly<{
  started: boolean;
  pid: number | undefined;
  log: string;
  reason?: string;
}> => {
  const runtime = crustRuntime(dbPath);
  if (runtime === undefined) {
    return { started: false, pid: undefined, log: "", reason: NO_RUNTIME };
  }
  const dir = sessionDir(dbPath, runId);
  mkdirSync(dir, { recursive: true });
  const log = join(dir, "steer.log");
  const child = spawn(
    "bun",
    [join(runtime, "steer.ts"), runId, activity, `--${target}`, note],
    {
      cwd: workspaceRoot(dbPath),
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CRUST_DB: dbPath },
    },
  );
  child.stdout?.on("data", (chunk) => appendFileSync(log, chunk));
  child.stderr?.on("data", (chunk) => appendFileSync(log, chunk));
  child.unref();
  return { started: true, pid: child.pid, log, reason: "" };
};

/**
 * Put a question to a finished activity, or ask it to amend its own document.
 *
 * Detached, like resuming. A consult rejoins a conversation that may be a
 * hundred thousand tokens and takes a minute to answer, while an HTTP
 * handler has milliseconds. The answer is not returned here: the CLI records
 * it against the activityRun, and the UI is already polling events, so it arrives
 * the way everything else a run produces arrives.
 *
 * The run's own tree is the cwd, because a activity's question is usually about
 * the repository it was reasoning over.
 */
export const startConsult = (
  dbPath: string,
  runId: string,
  activity: string,
  mode: "ask" | "amend",
  question: string,
): Readonly<{
  started: boolean;
  pid: number | undefined;
  log: string;
  reason?: string;
}> => {
  const runtime = crustRuntime(dbPath);
  if (runtime === undefined) {
    return { started: false, pid: undefined, log: "", reason: NO_RUNTIME };
  }
  const dir = sessionDir(dbPath, runId);
  mkdirSync(dir, { recursive: true });
  const log = join(dir, "consult.log");
  const child = spawn(
    "bun",
    [join(runtime, "consult.ts"), mode, runId, activity, question],
    {
      cwd: workspaceRoot(dbPath),
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      // The consult must read the SAME trace this server is serving, which
      // is not necessarily the one its cwd would resolve to.
      env: { ...process.env, CRUST_DB: dbPath },
    },
  );
  child.stdout?.on("data", (chunk) => appendFileSync(log, chunk));
  child.stderr?.on("data", (chunk) => appendFileSync(log, chunk));
  child.unref();
  return { started: true, pid: child.pid, log, reason: "" };
};

/**
 * Pick a waiting run back up, exactly as it was launched.
 *
 * Approve, reject and answer all MEAN "carry on" — a person who has just told
 * a run what to do has not asked to be given a command to type. Recording the
 * decision and then waiting for a second action was a design error: two
 * clicks for one intention.
 *
 * The argv comes from the `invocation.json` the run wrote at startup, because
 * the flags are not otherwise recoverable: `--approve-after plan` exists only
 * in argv, and the processes table stores the command space-joined, which
 * loses the boundaries of a prompt containing spaces.
 */
export const resumeRun = (
  dbPath: string,
  runId: string,
): Readonly<{ resumed: boolean; pid: number | undefined; reason: string }> => {
  const recorded = join(sessionDir(dbPath, runId), "invocation.json");
  if (!existsSync(recorded)) {
    return {
      resumed: false,
      pid: undefined,
      reason: `no invocation.json for ${runId} — resume it by hand`,
    };
  }
  const parsed = JSON.parse(readFileSync(recorded, "utf8")) as {
    argv?: unknown;
    cwd?: unknown;
  };
  const argv = Array.isArray(parsed.argv)
    ? parsed.argv.filter((part): part is string => typeof part === "string")
    : [];
  const script = argv[1] ?? "";
  if (script === "") {
    return { resumed: false, pid: undefined, reason: "recorded argv is unusable" };
  }
  // The run's own resume flags are stripped and re-appended, so resuming a
  // run that was already resumed does not stack duplicates onto the line.
  const carried = argv
    .slice(2)
    .filter(
      (arg, index, all) =>
        arg !== "--run-id" && all[index - 1] !== "--run-id" && arg !== "--resume",
    );
  const cwd = typeof parsed.cwd === "string" ? parsed.cwd : workspaceRoot(dbPath);
  // Detached, and it must stay that way. The terminal path attaches, because
  // somebody typed `approve` and is waiting; an HTTP handler has to answer in
  // milliseconds and has no terminal to attach to, so the run outlives the
  // request and its output goes to the session's own log.
  const log = join(sessionDir(dbPath, runId), "spawn.log");
  const child = spawn(
    "bun",
    [script, ...carried, "--run-id", runId, "--resume"],
    { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } },
  );
  child.stdout?.on("data", (chunk) => appendFileSync(log, chunk));
  child.stderr?.on("data", (chunk) => appendFileSync(log, chunk));
  child.unref();
  return { resumed: true, pid: child.pid, reason: "" };
};

/**
 * Start a Lifecycle, detached, and hand back the run id it will use.
 *
 * Through the Composer, naming the Lifecycle: there has been no file per
 * Lifecycle since the DAG landed, and there is no runtime in the stamp to
 * hold one if there were. The Composer reads `crust.lifecycles.yaml` in the
 * target tree, so a Lifecycle that repository added is startable from here
 * with no change on this side.
 *
 * Detached and with its output to a file rather than to this process: a run
 * outlives the request that asked for it, and a server that held the pipe
 * would stall the run the moment nobody was reading. The id is generated here
 * so the response can say where to watch before the child has written a row.
 */
export const startRun = (
  dbPath: string,
  lifecycle: string,
  prompt: string,
  extraArgs: readonly string[],
): Readonly<{
  run_id: string;
  pid: number | undefined;
  log: string;
  reason?: string;
}> => {
  const runtime = crustRuntime(dbPath);
  if (runtime === undefined) {
    return { run_id: "", pid: undefined, log: "", reason: NO_RUNTIME };
  }
  const root = workspaceRoot(dbPath);
  const runId = Math.random().toString(16).slice(2, 10);
  const logDir = join(dirname(dbPath), "sessions", runId);
  mkdirSync(logDir, { recursive: true });
  const log = join(logDir, "spawn.log");
  writeFileSync(log, "", "utf8");
  const child = spawn(
    "bun",
    [
      join(runtime, "lifecycles", "compose.ts"),
      prompt,
      "--lifecycle",
      lifecycle,
      "--run-id",
      runId,
      ...extraArgs,
    ],
    {
      cwd: root,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    },
  );
  child.stdout?.on("data", (chunk) => appendFileSync(log, chunk));
  child.stderr?.on("data", (chunk) => appendFileSync(log, chunk));
  child.unref();
  return { run_id: runId, pid: child.pid, log, reason: "" };
};
