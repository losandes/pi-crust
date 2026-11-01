/**
 * pi-crust visualizer server — JSON API over a target repo's crust.db, plus the
 * built UI when ./dist exists. Reads are read-only; the single write is
 * POST /api/sessions/:run_id/archive, which sets one review flag on a row.
 *
 * There is no ingest endpoint and no websocket. The data path is
 * agents → sqlite → web ui, and the UI gets there by polling.
 *
 *   bun run server/index.ts
 *   bun run server/index.ts --db /path/to/repo/.pi-crust/data/crust.db
 *   CRUST_DB=/path/to/crust.db CRUST_BE_PORT=4600 bun run server/index.ts
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { PiCrustDb } from "./db.ts";
import { handoffDirFor } from "./handoff.ts";
import { WorkspaceRegistry } from "./registry.ts";
import { BUILTIN_THEMES, themesForWorkspace } from "./themes.ts";
import {
  registryPath,
  registryStamp,
  resolveWorkspaces,
} from "./workspaces.ts";
import type {
  AgentPrompts,
  ApiError,
  DecisionRequest,
  HandoffFile,
  HealthResponse,
  WorkspaceInfo,
} from "../shared/types.ts";
import {
  isInboxKind,
  postMessage,
  startConsult,
  startupFailure,
  startSteer,
  recordDecision,
  refuseUnlessAuthorised,
  resumeRun,
  startRun,
} from "./writes.ts";

/*
 * CRUST_BE_PORT, and nothing else.
 *
 * This used to read `PORT`, which is the single most likely variable to be
 * already set for something else in a repository full of servers — and when it
 * is, the UI proxies to a port this process never bound and every request 404s
 * with nothing explaining why. A named variable cannot be set by accident.
 */
const PORT = Number(process.env.CRUST_BE_PORT ?? 4600);
const DIST_DIR = resolve(import.meta.dir, "..", "dist");

/**
 * Diagnostics go to the stream, not through `console`.
 *
 * The factory's own modules write with `process.stdout` for the same reason
 * the lint rule exists: `console` is a debugging habit that survives into
 * production code, and a server's output is a deliberate interface rather
 * than a leftover. Status lines go to stdout; anything that went wrong goes
 * to stderr, so piping one does not swallow the other.
 */
const say = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const warn = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

/*
 * The working trees this server watches.
 *
 * One database each, so a run's workspace is which database answered rather
 * than a column that can disagree with where the run actually is. With no
 * new flags this resolves to exactly the single database it always did.
 */
const registry = new WorkspaceRegistry(resolveWorkspaces(), {
  // A worktree added while this is running appears within one poll, because
  // the factory registers a tree as its first run starts. Restarting the UI
  // to see a new tree would mean restarting it exactly when it is in use.
  rescan: () => resolveWorkspaces(),
  stamp: () => registryStamp(registryPath()),
});
const initial = registry.states();

/*
 * Refusing to start is right only when NOTHING is readable.
 *
 * One unreachable tree among several is normal — a worktree with no run in it
 * yet has no trace file — and taking the server down over it would make the
 * multi-tree case less reliable than the single-tree case it replaced.
 */
if (initial.every((state) => state.db === undefined)) {
  for (const state of initial) {
    warn(`[crust] ${state.label}: ${state.error ?? "unreadable"}`);
  }
  process.exit(1);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function notFound(message: string): Response {
  return json({ error: message } satisfies ApiError, 404);
}

/** Guard every handler so a malformed query can't take the server down mid-run. */
function safely(
  handler: (req: Request) => Response | Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req) => {
    // biome-ignore lint/plugin/no-intermediate-try-catch: this IS the boundary, the one place a handler's exception becomes a 500 response instead of taking the server down
    try {
      return await handler(req);
    } catch (error) {
      warn(
        `[crust] ${req.method} ${new URL(req.url).pathname}: ${String(error)}`,
      );
      return json({ error: (error as Error).message } satisfies ApiError, 500);
    }
  };
}

/**
 * run ids and agent names are path segments on disk, so anything that isn't a
 * plain identifier is rejected outright rather than sanitized into something
 * that might still escape the sessions directory.
 */
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

function isSafeSegment(value: string): boolean {
  return SAFE_SEGMENT.test(value) && value !== "." && value !== "..";
}

function param(req: Request, key: string): string {
  return decodeURIComponent(
    (req as Request & { params: Record<string, string> }).params[key] ?? "",
  );
}

/**
 * Which workspace a request is about, when it says.
 *
 * Absent is the normal case for a link minted before workspaces existed, and
 * for anything a developer typed by hand, so it means "find the run" rather
 * than "use the default tree" — picking a default would answer confidently
 * from the wrong repository.
 */
function workspaceQuery(req: Request): string | undefined {
  const raw = new URL(req.url).searchParams.get("workspace");
  return raw === null || raw.trim() === "" ? undefined : raw.trim();
}

/** The database holding this run, honouring an explicit workspace. */
function forRun(req: Request, runId: string): PiCrustDb | undefined {
  return registry.resolve(runId, workspaceQuery(req));
}

function intQuery(req: Request, key: string, fallback: number): number {
  const raw = new URL(req.url).searchParams.get(key);
  if (raw === null || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Every file in a run's handoff directory, with the heading it opens with.
 *
 * The heading is what gives a card a title a human recognises — "Design —
 * Playback stats, ActivityRun 1" rather than `design.md`. Read from the first
 * kilobyte rather than the whole file, because a listing of ten documents
 * should not read half a megabyte to draw ten lines of text.
 */
function listHandoff(dir: string): HandoffFile[] {
  if (!existsSync(dir)) return [];
  const walk = (current: string, prefix: string): HandoffFile[] =>
    readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
      const full = join(current, entry.name);
      const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) return walk(full, path);
      if (!entry.isFile()) return [];
      return [
        {
          path: `context_handoff/${path}`,
          bytes: statSync(full).size,
          modified_at: statSync(full).mtime.toISOString(),
          title: firstHeading(full),
        },
      ];
    });
  return walk(dir, "");
}

const firstHeading = (file: string): string => {
  // biome-ignore lint/plugin/no-intermediate-try-catch: an unreadable file still exists, and saying so is the point, decided right here
  try {
    const head = readFileSync(file, "utf8").slice(0, 1024);
    const match = /^#\s+(.+)$/m.exec(head);
    return match?.[1]?.trim() ?? "";
  } catch (cause) {
    void cause;
    return "";
  }
};

/** Every watched tree as the UI sees it, reachable or not. */
function describeWorkspaces(): WorkspaceInfo[] {
  return registry.states().map((state) => ({
    label: state.label,
    root: state.root,
    db: state.dbPath,
    available: state.db !== undefined,
    ...(state.error === undefined ? {} : { error: state.error }),
    sessions: state.db?.sessionCount() ?? 0,
  }));
}

/**
 * The only workspace, when there is only one.
 *
 * Used where an action has to happen SOMEWHERE and the request did not say.
 * With one tree the answer is unambiguous and asking would be bureaucracy;
 * with several there is no defensible guess, so the caller reports that
 * instead of choosing.
 */
function soleWorkspace(): PiCrustDb | undefined {
  const available = registry.states().filter((state) => state.db !== undefined);
  return available.length === 1 ? available[0]?.db : undefined;
}

/** Serve the built SPA if it has been built; otherwise point at the dev server. */
function serveStatic(req: Request): Response {
  const { pathname } = new URL(req.url);

  if (!existsSync(DIST_DIR)) {
    return new Response(
      `pi-crust visualizer API is running on :${PORT}.\n\n` +
        `No ./dist build found. Run "bun run dev" for the Vite dev server ` +
        `(it proxies /api here), or "bun run build" to serve the UI from this process.\n`,
      { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  // Reject traversal before touching the filesystem.
  const candidate = resolve(join(DIST_DIR, pathname));
  if (candidate === DIST_DIR || candidate.startsWith(`${DIST_DIR}/`)) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return new Response(Bun.file(candidate));
    }
  }

  // SPA fallback: breadcrumb routes are client-side.
  const indexHtml = join(DIST_DIR, "index.html");
  if (existsSync(indexHtml)) {
    return new Response(Bun.file(indexHtml), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  return notFound("not found");
}

const server = Bun.serve({
  port: PORT,
  routes: {
    "/api/health": safely(() => {
      const states = registry.states();
      const first = states.find((state) => state.db !== undefined);
      return json({
        ok: true,
        db: first?.dbPath ?? "",
        journal_mode: first?.db?.journalMode ?? "unknown",
        sessions: registry.sessionCount(),
        workspaces: describeWorkspaces(),
      } satisfies HealthResponse);
    }),

    /** Every watched tree, including the ones that cannot currently be read. */
    "/api/workspaces": safely(() => json(describeWorkspaces())),

    /*
     * The themes a workspace registers.
     *
     * Per workspace rather than per server: this app observes one repository
     * at a time but can watch several, and a theme is the repository's
     * statement about itself. Absent a workspace, the first one answers —
     * the picker has to show something before anything is selected.
     */
    "/api/themes": safely((req) => {
      const label = workspaceQuery(req);
      const watched = registry.states();
      if (watched.length === 0) {
        return json({
          default: "auto",
          themes: BUILTIN_THEMES,
          problem: "no workspace is being watched",
        });
      }
      const found = themesForWorkspace(watched, label);
      if (found === undefined) {
        return notFound(`no workspace ${label}`);
      }
      return json(found);
    }),

    "/api/sessions": safely((req) => {
      const label = workspaceQuery(req);
      const limit = intQuery(req, "limit", 200);
      // A named workspace narrows the list; absent means every tree, which is
      // the whole reason this endpoint changed.
      const named = label === undefined ? undefined : registry.byLabel(label);
      if (label !== undefined && named === undefined) {
        return notFound(`no workspace ${label}`);
      }
      return json(named === undefined ? registry.sessions(limit) : named.sessions(limit));
    }),

    "/api/sessions/:run_id": safely((req) => {
      const runId = param(req, "run_id");
      const owner = forRun(req, runId);
      const detail = owner?.sessionDetail(runId);
      if (detail && owner) {
        /*
         * Computed here, not in `db.ts`: the db connection is readonly SQL
         * and must stay that way, and this is the one field on
         * `SessionDetail` that reads the filesystem instead of a row.
         */
        return json({
          ...detail,
          handoff_dir: resolve(handoffDirFor(owner.sessionsDir, runId)),
        });
      }
      /*
       * A run REFUSED at load has no session row and never will — a
       * concurrent Stage with overlapping `writes` is the case this exists
       * for. The reason is in the log the spawn wrote, and without it the UI
       * shows a run that simply never appeared.
       */
      const failure = owner && startupFailure(owner.path, runId);
      return notFound(
        failure ? `run ${runId} did not start:\n${failure}` : `no session ${runId}`,
      );
    }),

    /*
     * ── Writes ───────────────────────────────────────────────────────────
     * Every one of these is behind CRUST_TOKEN, unconditionally. They steer
     * live agents, answer gates on a person's behalf, and start runs that
     * spend money; "it came from localhost" is not an identity.
     */

    // Say something to an agent that is working right now. The message lands
    // in the run's inbox and the running activityRun delivers it to pi as a steer,
    // a follow-up, or an abort.
    "/api/sessions/:run_id/messages": {
      POST: safely(async (req) => {
        const refusal = refuseUnlessAuthorised(req);
        if (refusal) return refusal;
        const runId = param(req, "run_id");
        if (!isSafeSegment(runId)) {
          return json({ error: "invalid run_id" } satisfies ApiError, 400);
        }
        const body = (await req.json().catch(() => ({}))) as {
          kind?: unknown;
          message?: unknown;
          from?: unknown;
        };
        if (!isInboxKind(body.kind)) {
          return json(
            { error: "kind must be steer, follow_up or abort" } satisfies ApiError,
            400,
          );
        }
        const message = typeof body.message === "string" ? body.message : "";
        if (body.kind !== "abort" && message.trim() === "") {
          return json(
            { error: "a steer or follow_up needs a message" } satisfies ApiError,
            400,
          );
        }
        const from = typeof body.from === "string" && body.from !== "" ? body.from : "the web app";
        // The run's OWN database, not this server's first one: an inbox is a
        // file beside the run, and writing it beside the wrong tree would
        // steer a different agent, or none.
        const owner = forRun(req, runId);
        if (!owner) return notFound(`no session ${runId}`);
        return json(postMessage(owner.path, runId, body.kind, message, from));
      }),
    },

    // Answer a gate, and carry on. Approve, reject and answer all MEAN
    // "continue" — handing back a command to type would be two actions for
    // one intention.
    "/api/sessions/:run_id/decision": {
      POST: safely(async (req) => {
        const refusal = refuseUnlessAuthorised(req);
        if (refusal) return refusal;
        const runId = param(req, "run_id");
        if (!isSafeSegment(runId)) {
          return json({ error: "invalid run_id" } satisfies ApiError, 400);
        }
        const body = (await req.json().catch(() => ({}))) as {
          action?: unknown;
          text?: unknown;
          from?: unknown;
        };
        const action = body.action;
        if (action !== "approve" && action !== "reject" && action !== "answer") {
          return json(
            { error: "action must be approve, reject or answer" } satisfies ApiError,
            400,
          );
        }
        const text = typeof body.text === "string" ? body.text : "";
        if (action !== "approve" && text.trim() === "") {
          return json(
            { error: `a ${action} needs text` } satisfies ApiError,
            400,
          );
        }
        const from = typeof body.from === "string" && body.from !== "" ? body.from : "the web app";
        const owner = forRun(req, runId);
        if (!owner) return notFound(`no session ${runId}`);
        const path = recordDecision(owner.path, runId, action, text, from);
        // Resume re-launches the run in ITS tree, read from the invocation
        // record that tree holds.
        const resumed = resumeRun(owner.path, runId);
        return json({ run_id: runId, action, recorded: path, ...resumed });
      }),
    },

    /*
     * Pick a FINISHED run back up, where nothing is being answered.
     *
     * Separate from `/decision`, which records an approve, reject or answer
     * against a gate and resumes as a consequence. A run that failed has no
     * gate waiting and no decision to record — the developer fixed what
     * broke it and wants it continued — and posting a decision to say so
     * would write a gate answer nobody gave.
     *
     * Needed because a consult does not move a run. An `amend` rewrites a
     * document and opens no Activity Run by design, so after correcting the
     * thing that failed there was no way forward from this UI at all.
     */
    "/api/sessions/:run_id/resume": {
      POST: safely(async (req) => {
        const refusal = refuseUnlessAuthorised(req);
        if (refusal) return refusal;
        const runId = param(req, "run_id");
        if (!isSafeSegment(runId)) {
          return json({ error: "invalid run_id" } satisfies ApiError, 400);
        }
        const body = (await req.json().catch(() => ({}))) as { note?: unknown };
        if (body.note !== undefined && typeof body.note !== "string") {
          return json({ error: "note must be a string" } satisfies ApiError, 400);
        }
        const note = typeof body.note === "string" ? body.note : "";
        const owner = forRun(req, runId);
        if (!owner) return notFound(`no session ${runId}`);
        const resumed = resumeRun(owner.path, runId, note, "the web app");
        return resumed.resumed
          ? json({ run_id: runId, ...resumed })
          : json({ error: resumed.reason } satisfies ApiError, 503);
      }),
    },

    // Start a lifecycle. The heaviest thing this server can do, so it is the
    // one that most needs the token in front of it.
    "/api/runs": {
      POST: safely(async (req) => {
        const refusal = refuseUnlessAuthorised(req);
        if (refusal) return refusal;
        const body = (await req.json().catch(() => ({}))) as {
          lifecycle?: unknown;
          prompt?: unknown;
          args?: unknown;
          workspace?: unknown;
        };
        const lifecycle = typeof body.lifecycle === "string" ? body.lifecycle : "";
        const prompt = typeof body.prompt === "string" ? body.prompt : "";
        if (!isSafeSegment(lifecycle) || prompt.trim() === "") {
          return json(
            { error: "lifecycle and prompt are required" } satisfies ApiError,
            400,
          );
        }
        // Flags are passed through as given, but only as separate argv
        // entries — never a shell string, which is how an injection gets in.
        const args = Array.isArray(body.args)
          ? body.args.filter((arg): arg is string => typeof arg === "string")
          : [];
        /*
         * Starting a run needs a tree to start it IN, and there is no sane
         * default once several are watched: picking the first would spend
         * money in a repository the developer was not looking at. Naming it
         * is required whenever there is more than one.
         */
        const requested = typeof body.workspace === "string" ? body.workspace : "";
        const target =
          requested === "" ? soleWorkspace() : registry.byLabel(requested);
        if (!target) {
          return json(
            {
              error:
                requested === ""
                  ? "name the workspace to run in: several are being watched"
                  : `no workspace ${requested}`,
            } satisfies ApiError,
            400,
          );
        }
        const started = startRun(target.path, lifecycle, prompt, args);
        // A refusal is a 503, not a 200 with a falsy field. The UI shows what
        // the server says; a success-shaped body for a run that never started
        // is the defect this whole route had.
        return started.run_id === ""
          ? json({ error: started.reason ?? "" } satisfies ApiError, 503)
          : json(started);
      }),
    },

    // Archiving is review triage — it belongs to the reader, not to the run —
    // so it never touches anything a tracer wrote. It is still a write.
    /*
     * Ask a finished Activity Run a question, or have it amend its own document.
     *
     * Behind the token like every write: `amend` rewrites a document, and
     * even `ask` spends money on a model.
     */
    "/api/sessions/:run_id/activities/:activity/consult": {
      POST: safely(async (req) => {
        const refusal = refuseUnlessAuthorised(req);
        if (refusal) return refusal;
        const runId = param(req, "run_id");
        const activity = param(req, "activity");
        if (!(isSafeSegment(runId) && isSafeSegment(activity))) {
          return json({ error: "invalid run_id or activity" } satisfies ApiError, 400);
        }
        const body = (await req.json().catch(() => ({}))) as {
          mode?: unknown;
          question?: unknown;
        };
        const mode = body.mode === "amend" ? "amend" : "ask";
        const question = typeof body.question === "string" ? body.question : "";
        if (question.trim() === "") {
          return json(
            { error: "a consult needs a question" } satisfies ApiError,
            400,
          );
        }
        const owner = forRun(req, runId);
        if (!owner) return notFound(`no session ${runId}`);
        const started = startConsult(owner.path, runId, activity, mode, question);
        return started.started
          ? json({ run_id: runId, activity, mode, ...started })
          : json({ error: started.reason ?? "" } satisfies ApiError, 503);
      }),
    },

    /*
     * Send a run back to an Activity Run. The target is REQUIRED in the body and
     * not defaulted here: overwrite discards the path being steered away
     * from, and a default on that choice is a choice made by habit.
     */
    "/api/sessions/:run_id/activities/:activity/steer": {
      POST: safely(async (req) => {
        const refusal = refuseUnlessAuthorised(req);
        if (refusal) return refusal;
        const runId = param(req, "run_id");
        const activity = param(req, "activity");
        if (!(isSafeSegment(runId) && isSafeSegment(activity))) {
          return json({ error: "invalid run_id or activity" } satisfies ApiError, 400);
        }
        const body = (await req.json().catch(() => ({}))) as {
          target?: unknown;
          note?: unknown;
        };
        if (body.target !== "overwrite" && body.target !== "branch") {
          return json(
            { error: "target must be overwrite or branch" } satisfies ApiError,
            400,
          );
        }
        const note = typeof body.note === "string" ? body.note : "";
        if (note.trim() === "") {
          return json(
            { error: "steering needs an instruction" } satisfies ApiError,
            400,
          );
        }
        const owner = forRun(req, runId);
        if (!owner) return notFound(`no session ${runId}`);
        /*
         * Minted here, the same way `startRun` mints a run id, because a
         * branch detaches: the response cannot wait to learn what the child
         * decided, and the id has to exist before anybody can be told to
         * watch it.
         */
        const branchRunId =
          body.target === "branch" ? Math.random().toString(16).slice(2, 10) : undefined;
        const started = startSteer(
          owner.path,
          runId,
          activity,
          body.target,
          note,
          branchRunId,
        );
        return started.started
          ? json({ run_id: runId, activity, target: body.target, ...started })
          : json({ error: started.reason ?? "" } satisfies ApiError, 503);
      }),
    },

    "/api/sessions/:run_id/archive": {
      POST: safely(async (req) => {
        const refusal = refuseUnlessAuthorised(req);
        if (refusal) return refusal;
        const runId = param(req, "run_id");
        if (!isSafeSegment(runId)) {
          return json({ error: "invalid run_id" } satisfies ApiError, 400);
        }
        const body = (await req.json().catch(() => ({}))) as { archived?: unknown };
        const archived = body.archived === undefined ? true : Boolean(body.archived);
        const owner = forRun(req, runId);
        if (!owner) return notFound(`no session ${runId}`);
        return owner.setArchived(runId, archived)
          ? json({ run_id: runId, archived })
          : notFound(`no session ${runId}`);
      }),
    },

    "/api/sessions/:run_id/events": safely((req) => {
      const runId = param(req, "run_id");
      const owner = forRun(req, runId);
      if (!owner) return notFound(`no session ${runId}`);
      return json(
        owner.events(runId, intQuery(req, "after", 0), intQuery(req, "limit", 500)),
      );
    }),

    "/api/sessions/:run_id/envelopes": safely((req) => {
      const runId = param(req, "run_id");
      const owner = forRun(req, runId);
      return owner ? json(owner.envelopes(runId)) : notFound(`no session ${runId}`);
    }),

    "/api/sessions/:run_id/gates": safely((req) => {
      const runId = param(req, "run_id");
      const owner = forRun(req, runId);
      return owner ? json(owner.gates(runId)) : notFound(`no session ${runId}`);
    }),

    /*
     * What the gate is actually asking.
     *
     * The gate writes its question to the session's handoff directory and the
     * terminal prints the path. A person reading the run in a browser got the
     * buttons to answer with and no sight of the question — which is asking
     * somebody to approve something they cannot read.
     */
    "/api/sessions/:run_id/decision-request": safely(async (req) => {
      const runId = param(req, "run_id");
      if (!isSafeSegment(runId)) {
        return json({ error: "invalid run_id" } satisfies ApiError, 400);
      }
      const db = forRun(req, runId);
      if (!db) return notFound(`no session ${runId}`);

      const dir = resolve(handoffDirFor(db.sessionsDir, runId));

      const file = Bun.file(join(dir, "decision-request.md"));
      /*
       * Absent is a normal state, not an error: most runs are not at a gate.
       * It reads as `present: false` rather than a null body so the client
       * branches on a flag instead of on the shape of a value.
       */
      if (!(await file.exists())) {
        return json({ present: false } satisfies DecisionRequest);
      }
      return json({
        present: true,
        markdown: await file.text(),
      } satisfies DecisionRequest);
    }),

    /*
     * The documents a run actually wrote, and their contents.
     *
     * The listing exists because `artifacts` on an envelope is self-reported:
     * it is the only source for a file written outside the session, and the
     * only one that knows what a file MEANS, but nothing checks it. The disk
     * cannot be wrong about what is there.
     *
     * Contents are served so a reader can open a document without leaving the
     * page. Text only, and only from inside the handoff directory.
     */
    "/api/sessions/:run_id/handoff": safely((req) => {
      const runId = param(req, "run_id");
      if (!isSafeSegment(runId)) {
        return json({ error: "invalid run_id" } satisfies ApiError, 400);
      }
      const db = forRun(req, runId);
      if (!db) return notFound(`no session ${runId}`);
      const dir = resolve(handoffDirFor(db.sessionsDir, runId));
      return json(listHandoff(dir) satisfies HandoffFile[]);
    }),

    "/api/sessions/:run_id/handoff/*": safely(async (req) => {
      const runId = param(req, "run_id");
      const relative = decodeURIComponent(new URL(req.url).pathname.split("/handoff/")[1] ?? "");
      if (!isSafeSegment(runId)) {
        return json({ error: "invalid run_id" } satisfies ApiError, 400);
      }
      const db = forRun(req, runId);
      if (!db) return notFound(`no session ${runId}`);
      const dir = resolve(handoffDirFor(db.sessionsDir, runId));
      const file = resolve(dir, relative);
      /*
       * Containment is checked on the RESOLVED path rather than on the text
       * of the request. A segment check alone passes `a/../../b`, which reads
       * as three innocent segments and lands outside the directory.
       */
      if (!file.startsWith(dir + sep)) {
        return json({ error: "invalid path" } satisfies ApiError, 400);
      }
      const handle = Bun.file(file);
      if (!(await handle.exists())) return notFound(`no file ${relative}`);
      // Always text/plain: this serves model-written content, and a browser
      // asked to render it as html would execute whatever it contains.
      return new Response(await handle.text(), {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }),

    // The exact prompts an agent was sent, read from the session dir. Files are
    // the raw record; the db has no copy of them.
    "/api/sessions/:run_id/agents/:agent/prompts": safely(async (req) => {
      const runId = param(req, "run_id");
      const agent = param(req, "agent");
      if (!(isSafeSegment(runId) && isSafeSegment(agent))) {
        return json({ error: "invalid run_id or agent" } satisfies ApiError, 400);
      }
      const db = forRun(req, runId);
      if (!db) return notFound(`no session ${runId}`);

      const dir = resolve(db.sessionsDir, runId, agent, "prompts");
      // Defense in depth: the segment check already forbids traversal.
      if (dir !== db.sessionsDir && !dir.startsWith(db.sessionsDir + sep)) {
        return json({ error: "invalid path" } satisfies ApiError, 400);
      }

      // A prompt file is absent whenever the agent never ran in this session —
      // a normal state, so it reads as null rather than an error.
      const read = async (name: string): Promise<string | null> => {
        const file = Bun.file(join(dir, `${name}.md`));
        return (await file.exists()) ? await file.text() : null;
      };
      return json({
        system: await read("system"),
        user: await read("user"),
      } satisfies AgentPrompts);
    }),
  },

  fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname.startsWith("/api/")) return notFound(`no route ${pathname}`);
    return serveStatic(req);
  },
});

say(`[crust] visualizer api  http://localhost:${server.port}`);
for (const state of registry.states()) {
  say(
    state.db
      ? `[crust] workspace       ${state.label}  ${state.dbPath}  ` +
          `[journal_mode=${state.db.journalMode}]`
      : `[crust] workspace       ${state.label}  unavailable — ${state.error ?? "unreadable"}`,
  );
}
say(
  existsSync(DIST_DIR)
    ? `[crust] serving ui from  ${DIST_DIR}`
    : `[crust] no ./dist — use "bun run dev" for the Vite dev server on :4601`,
);

process.on("SIGINT", () => {
  registry.close();
  process.exit(0);
});
