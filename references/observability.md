# Observability Reference

The event schema, the nine SQLite tables, and the polling contract — the one data path is **agents → sqlite → web ui**.

## Hiding filesystem paths

The visualizer hides the home directory and each run's recorded repository and working-tree roots in displayed text and tooltips by default. It uses `<repo>` for the repository, `<worktree>` for a different working tree, `~` for home, and `<path>` for a cut-off root. Repository and branch tooltips show shortened display locations; repository filters still select by the recorded root.

To see full filesystem paths, start it with:

```sh
CRUST_REDACT_PATHS=false crust observe
```

Only the exact value `false` turns redaction off. To restore it, restart `crust observe` without that value and reload the page. The browser waits for the API's setting before displaying run data. API responses and recorded data keep their full paths; this protects the visualizer's page, not the network inspector or a raw document opened in another tab.

## Two stores, one truth

**Files are the raw record** (`raw_output.jsonl` streams, `envelope.json`, `agent_map.json`); **SQLite (`crust.db`) is the queryable mirror** the UI reads. `trace-db.ts` writes both. Losing the db loses nothing that can't be rebuilt from files.

One trace per machine lives at `~/.pi-crust/data/crust.db`, alongside repository-grouped `sessions/` ([where a run's files are](#where-a-runs-files-are)). `defaults.data_dir` in the merged TOML layers moves both together; `CRUST_DATA_DIR` overrides it. `CRUST_DB` and supported `--db` flags select a store for one reading command, not where runs write. No install step copies or freezes the defaults.

`sessions.repository_root` records the repository's primary working tree, shared by linked worktrees; `workspace_root` records the particular working tree. An existing database gains the nullable `repository_root` column the first time a run writes to it; earlier rows and events are left unchanged. Read-only commands do not alter a database. Earlier per-repository traces stay untouched under the defaults.

## Where a run's files are

New runs live at `<data-dir>/sessions/<repository path>/<run-id>/`. The shared `lib/repository-path` package derives the repository path from the `origin` remote URL using these steps:

1. Trim surrounding whitespace.
2. Find the path part: for a URL matching `^[A-Za-z][A-Za-z0-9+.-]*://`, take everything after the first `/` following `://`; a `file` scheme (case-insensitive), or no such slash, gives no result. Otherwise, if it contains a `:` before the first `/` (or contains a `:` and no `/`), take everything after that colon. Other values are filesystem locations and give no result.
3. Remove every leading and trailing `/`, then remove one trailing `.git`.
4. Split on `/`. Reject fewer than two segments, an empty segment, `.` or `..`, or any segment containing a backslash or NUL.
5. Keep the segments unchanged, without decoding or changing case: the last is the repository, and all preceding segments are owner levels.

Only `origin` is read; the host does not participate in the path. With no usable origin, the path is `local/<name>-<hash8>`, where `name` is the primary clone's basename and `hash8` is the first eight hexadecimal characters of SHA-256 over its real absolute path encoded as UTF-8. Linked worktrees use the same primary clone. An owner named `local` is treated like any other owner.

For example, the sessions directory may contain `losandes/pi-crust/<run-id>/`, `group/subgroup/project/<run-id>/`, `local/notes-1a2b3c4d/<run-id>/`, and earlier runs directly at `<run-id>/`. Each run directory contains its event log, invocation, agent directories and default `context_handoff/`; `--handoff` can relocate only the handoff documents.

Before creating a new run directory, `run_directories(run_id, repository_dir)` records its repository path relative to the sessions directory, while `repository_directories(path)` reserves every grouping prefix (each owner level and the repository directory). Claims validate and reserve under one `BEGIN IMMEDIATE` transaction. Every reader resolves the recorded placement by run id, falling back to the flat location when there is no record, so changing a remote or removing a worktree does not move a run. A pinned id with an existing flat directory stays there without a registry entry. Existing directories are never moved or renamed.

A claim is refused if an ancestor belongs to a known run, its target is a reserved grouping directory, or its target already exists; the message identifies the run and conflicting directory, leaving pruning or renaming to the developer. Pruning removes only the selected runs and their placement records, retaining grouping directories and their reservations.

## Event schema

`trace-db.ts` emits these types, every one logged against its `run_id` **and** `activity_run_id`:

| Type                 | Emitted when                                                                                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activity_run_start` | a `activity run(activityRunParams({...}), body)` block is entered                                                                                                                      |
| `agent_start`        | a coding agent is spawned or resumed for `callAgent(run, ph, {...})`                                                                                                                   |
| `tool_call`          | a tool (`read`, `bash`, `edit`, `write`) returns — **one event per real call**, named `bash: ls -la src`, payload `{tool, tool_call_id, args, result_snippet, ok, duration_ms, agent}` |
| `handoff`            | an envelope crosses from one agent to the next                                                                                                                                         |
| `gate_pass`          | a gate found no failed checks — payload carries `checks` (the evidence) and an empty `violations`                                                                                      |
| `gate_fail`          | a gate found at least one failed check — payload carries `checks` and `violations`                                                                                                     |
| `log`                | an explicit `ph.log(...)` from the workflow script                                                                                                                                     |
| `agent_end`          | the agent's run completes; envelope parsed or not — payload carries `cost`, `usage` (the per-component breakdown), `context_tokens`, `context_window`                                  |
| `activity_run_end`   | the block exits; carries the resolved status                                                                                                                                           |
| `error`              | a raise inside a activity run block                                                                                                                                                    |

`parent_id` nests spans, so an agent activity run expands into its tool-call spans in the UI.

**Spend is itemised per activity run.** `agent_end.usage` carries tokens *and* dollars for each component pi reports — `input`, `output`, `cache_read`, `cache_write` — summed across every send the activity run made, so a activity run that re-prompted on a bad envelope shows what all of them cost, not just the last. A gate failure is a new Activity Run with its own row, so its spend sits beside the one it followed rather than folded into it. The four components sum to `total_tokens`, and their costs sum to `total_cost`; the visualizer's Cost panel renders them as a table you can add up by eye.

`reasoning_tokens` is the thinking share and is **inside** `output_tokens`, not a fifth component — measured across every session on disk, reasoning never exceeds output and the four components always reconcile to the total. It bills at the output rate, so the panel nests it under output rather than adding it. Runs predating the breakdown have no `usage` key at all; the lump `cost` and the event's own `tokens` still stand, and the UI says so rather than rendering zeroes.

**Context is occupancy, not spend.** `events.tokens` and `sessions.total_tokens` bill every turn, so they only grow — an agent that burned 100k tokens may be sitting in a 15k window. `context_tokens` is how full the window actually was when the agent stopped, which is what the visualizer's per-lane Context bar measures against `context_window`.

It is computed the way pi computes it for its own footer and its auto-compaction trigger (`calculateContextTokens` in the coding agent's `core/compaction/compaction.ts`): take the last *valid* assistant turn — skipping `aborted` and `error` turns — and read `usage.totalTokens`, falling back to `input + output + cacheRead + cacheWrite`. Cache reads count; cached prompt is still prompt. `context_window` is the same `contextWindow` pi reads from `~/.pi/agent/models.json`, so `context_tokens / context_window` is the number pi would show. Both are NULL on rows written before the columns existed, and the lane draws no bar rather than a misleading empty one.

Two caveats worth knowing. Pi adds an *estimate* for any messages trailing the last assistant usage; in a batch (`-p`) run the session ends on that message, so the two agree. And if auto-compaction fires as the very last act of a run, the recorded number is the pre-compaction size — pi itself reports `null` in that window rather than guessing.

**Gates record evidence, not just a verdict.** A gate returns one `{item, ok, note}` check per thing it looked at, and `violations` are derived from the failed ones. Both land in `gate_results` (`checks_json` + `violations_json`) and in the `gate_pass`/`gate_fail` payload, so a green gate can answer *what did you verify* — `{"item": "…/plan.md", "ok": true, "note": "exists, 454B"}` — rather than only *did it pass*. Rows written before this existed have `checks_json` NULL; treat that as "no evidence recorded", not "nothing checked".

The gate event payload carries `activity_run_id` too, so the `gate_results` table and the event stream are equivalent sources — a live consumer can group gate results by the Activity Run that produced them from events alone, without a second query.

**Tool calls and completed repository tasks span time.** A `tool_call` fills both `started_at` and `ended_at` on the row — the tool's real start and return. A `log` event named `task_end` also fills both columns, covering the task's first command start through its last command end. Other events are points in time: `started_at` is when they were recorded and `ended_at` stays NULL. Lay spans out on a time axis from those columns, never by parsing `payload_json` (`duration_ms` is in tool-call payloads too, as pi's own number, but it is a convenience, not the source for layout).

**Repository tasks appear as blocks in the run chart's code row.** The recorder writes a `log` event named `task_start` when the first command starts, with payload `{task, execution, moment, instances}`, and a `task_end` when the last command ends, with `{task, execution, moment, instances, output_artifact, passed}`. The unique `execution` pairs the events across repeated tasks and retries; `moment` is `change`, `after`, `before` or `deliver`, and `passed` is true only if every command passed. The chart shows the start as running while the session is running and no task or Activity Run has started later, then uses the end event's span and verdict for the finished block. An interrupted start with no end is not shown once it is no longer live. These events attach to the same Activity Run as the existing `task:<name>` command events; clicking a task block opens that Activity Run's detail. They add no Activity Run rows and do not affect routing, resume or the run verdict.

**Streaming is solved by construction.** `data/pi-agent.ts` tails pi's JSONL stdout line by line and the tracer inserts each event into `crust.db` **while the agent is still working** — never batched at activity run end (verified in the first smoke run: tool calls visible mid-run). Everything downstream is a poll → render.

## Tables

```sql
sessions (
  run_id        TEXT PRIMARY KEY,
  request       TEXT,              -- the engineer's ask
  status        TEXT,              -- running | success | fail
  engineer      TEXT,
  started_at    TEXT, ended_at TEXT,
  total_tokens  INTEGER, total_cost REAL,
  repository_root TEXT,           -- repository primary working tree
  workspace_root TEXT             -- working tree used by this run
);

activity runs (
  activity_run_id      TEXT PRIMARY KEY,
  run_id        TEXT REFERENCES sessions,
  seq           INTEGER,
  name TEXT, kind TEXT, owner TEXT, description TEXT,
  status        TEXT DEFAULT 'fail',   -- success must be earned
  error         TEXT,
  started_at    TEXT, ended_at TEXT
);

events (
  event_id      TEXT PRIMARY KEY,
  run_id        TEXT REFERENCES sessions,
  activity_run_id      TEXT REFERENCES activity runs,   -- every event logs against run + activity run
  parent_id     TEXT,                     -- span nesting
  type          TEXT,   -- activity_run_start | activity_run_end | agent_start | agent_end | tool_call
                        -- | handoff | gate_pass | gate_fail | log | error
  name          TEXT,
  payload_json  TEXT,
  tokens        INTEGER,
  started_at    TEXT, ended_at TEXT   -- ended_at set only on events that span time
);

envelopes (
  envelope_id   TEXT PRIMARY KEY,
  run_id        TEXT REFERENCES sessions,
  activity_run_id      TEXT REFERENCES activity runs,
  agent         TEXT,
  output_type   TEXT,              -- name of the data_types model it parsed against
  payload_json  TEXT,
  valid         INTEGER,
  created_at    TEXT
);

gate_results (
  id            INTEGER PRIMARY KEY,
  run_id        TEXT REFERENCES sessions,
  activity_run_id      TEXT REFERENCES activity runs,
  gate          TEXT,
  passed        INTEGER,
  violations_json TEXT,             -- derived: the failed checks, as "item: note"
  checks_json   TEXT,               -- [{item, ok, note}] — everything the gate looked at
  created_at    TEXT
);

processes (                        -- run_id → pid, so a stuck run can be stopped
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id        TEXT REFERENCES sessions,
  kind          TEXT,               -- 'run' (the lifecycle's own process) | 'agent' (a coding-agent child)
  name          TEXT,               -- '' for the run itself, the agent name for a child
  pid           INTEGER,
  command       TEXT,               -- what the pid WAS; pids get recycled, so verify before killing
  started_at    TEXT, ended_at TEXT -- ended_at NULL = believed alive
);

agent_sessions (                   -- the queryable mirror of agent_map.json
  run_id        TEXT REFERENCES sessions,
  agent         TEXT,
  coding_agent  TEXT, model TEXT, color TEXT,   -- color: the config's lane swatch
  session_id    TEXT,
  context_tokens INTEGER,           -- window occupancy after the agent's last turn
  context_window INTEGER,           -- the model's ceiling, from the pi registry
  created_at    TEXT, last_used_at TEXT,
  PRIMARY KEY (run_id, agent)
);
```

**A hung agent emits nothing**, which is exactly when you need its pid: no events, no tokens, no output to read. `processes` is the only table that can answer "what is this run running, and how do I stop it" — `crust procs <run_id>` lists what is live, `crust kill <run_id>` stops children before the parent, and both verify the recorded `command` still matches the pid before signalling it. A killed run finalizes its own trace: SIGTERM and SIGINT are turned into `SystemExit` in `session.ensure`, so the session lands on `fail` with its process rows closed instead of reading `running` forever.

**Derived, never stored:** activity run durations (`ended_at − started_at`), session activity run-progress (query `activity-runs` by `run_id`), lane layout (`kind` + `owner`).

Activity Run status invariants: `queued` only for manifest-declared activity runs not yet entered (dashed in the UI); `running` on enter; only a clean exit writes `success` — agent activity runs additionally need the envelope parsed and gates green, and terminal Activity Runs additionally need `pull_request_opened` green. A failed delivery gate resolves to `fail`; a run stopped at the delivery gate is `waiting`. Waiting on a refused commit opens no terminal row, while a recoverable delivery refusal leaves its terminal row `waiting`. A terminal cancellation has a `cancelled` row. On resume, that row is recoverable only if no `terminal_cancelled` event for the same terminal Activity carries a reason other than `a counted activity run in this run failed`; a recorded rejection or unknown reason still blocks delivery. Once no other failure stands and the run is accepted without rejection, the recoverable row is marked `superseded` and delivery is attempted again. For fold Activities, `blocked` and `cancelled` are not activity run rows: nothing started, so there is nothing to open a row for. They arrive as `activities_blocked` and `activities_cancelled` events naming what the run did not reach and why — blocked when a person is holding it and the work is still owed, cancelled when it is not coming. Without them a halted run leaves everything downstream with no record at all, which reads the same as a lifecycle that never had those Activities.

## WAL pragmas

Open **every** connection — writer and reader — with:

```sql
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA busy_timeout=5000;
```

WAL allows readers during writes. Writers are the tracers of running workflow processes; concurrent writers are fine given one small transaction per event plus `busy_timeout`. The visualizer reads on a readonly connection with exactly one exception: archiving a session (`POST /api/sessions/:run_id/archive`) opens a second connection to set `sessions.archived`. That flag is review triage — it says a human has looked at the run — so it is the reader's state living on the row, and no tracer ever writes or reads it.

## Polling contract

**The UI never receives pushes.** No ingest endpoint, no WebSocket, no backfill or dedup logic.

Set positive-integer `poll_ms` in `crust.config.toml` in the package or machine layer, or in the repository TOML file; its default is 500 milliseconds. The launcher sends the merged value to the server through `CRUST_POLL_MS`, and `GET /api/health` returns `poll_ms` to the browser before mounting. The session list, trace and live cards use that interval. An existing exported `CRUST_POLL_MS` is not an override. Live event polling uses a rowid cursor:

```sql
SELECT ... FROM events WHERE run_id = ? AND rowid > ? ORDER BY rowid LIMIT 500;
```

Keep the highest `rowid` returned as the next cursor. History is **the same queries** with filters, lazy-paged as the engineer scrolls or drills in — one mechanism serves both live and past runs, which is why there is no separate replay path.

## The run reporter

```text
crust report [<run-id>] [--json] [--db <path>] [--config <path>]
```

No `run-id` means the most recent session in the whole shared trace. `--db` wins over `CRUST_DB`, then the database derived from `defaults.data_dir`. The connection is opened **readonly** with a busy timeout, so asking where a run got to never blocks a run that is still writing.

Exit codes, because an agent will branch on them:

| Code | Means                                                |
| ---- | ---------------------------------------------------- |
| `0`  | the run succeeded and has no unfinished activity run |
| `1`  | it failed, or it is incomplete                       |
| `2`  | no such session, or a usage error                    |

### `TRunState` — the JSON contract

`--json` emits this verbatim. It is parsed by agents, so it changes only deliberately.

```json
{
  "run_id": "a1b2c3d4",
  "lifecycle": "ship",
  "request": "add a /health endpoint",
  "status": "running",
  "engineer": "andy",
  "started_at": "2024-01-01T00:00:00.000Z",
  "ended_at": "2024-01-01T00:08:00.000Z",
  "tokens": 12345,
  "cost": 0.4212,
  "activity runs": [
    {
      "seq": 3, "activity_run_id": "a1b2c3d4_03_build",
      "name": "build", "kind": "agent", "owner": "builder",
      "description": "Implement the plan exactly",
      "status": "fail",
      "error": "build failed its gates and has no attempts left",
      "started_at": "…", "ended_at": "…",
      "gates": [
        { "gate": "diffMatchesClaims", "activity run": "build",
          "passed": false, "violations": ["src/a.ts: not in the diff"],
          "checks": [{ "item": "src/a.ts", "ok": false, "note": "not in the diff" }] }
      ],
      "logs": [{ "name": "step_result", "payload": { "passed": false } }]
    }
  ],
  "completed": ["request", "plan"],
  "resume_from": "build",
  "failed_gates": [ … ],
  "warnings": [
    { "kind": "unexpected", "activities": ["build"],
      "activityRunIds": ["a1b2c3d4_03_build"], "stage": "implement",
      "paths": ["src/add.ts"], "note": "" }
  ],
  "envelopes": [
    { "activity run": "build", "agent": "builder", "output_type": "BuildOutput",
      "valid": true, "payload": { … } }
  ]
}
```

Four fields carry the weight:

- **`completed`** — activity run names whose LATEST record is `success`. A session that ran `build` twice and failed the second time does not list `build`; the latest record per name wins, which is what makes resume correct across a joined session.
- **`resume_from`** — the first activity run, in `seq` order, whose latest record is not success. `undefined` (absent from the JSON) means every RECORDED activity run succeeded — not necessarily that the run is finished, since a session that died between Activities has no row for the ones it never reached.
- **`resumable`** — is there anything left to pick up, from the session's own status rather than from `resume_from`. `false` only for a session that finished successfully; a session that failed, was killed, or is waiting for a person is resumable even when `resume_from` is `undefined`, which is what lets `--resume` and this report pick up a run that died between Activities.
- **`warnings`** — what the run saw and could not attribute, read back from its own `tree_warning` events. `unexpected` is a path that changed during an Activity Run which was not already dirty and which the Activity did not report; `overstep` is a path outside what the Activity declared it writes; `refusal` is a tool call the path policy governed; `uncommitted` is a refused or timed-out commit — an unanswered signing prompt, a hook that exits non-zero. A `recovered` record on that same channel means a previously refused commit landed or nothing was left to commit. Reported warnings omit every `recovered` record and drop an `uncommitted` warning when a later `uncommitted` or `recovered` entry names at least one of its Activities; other kinds are untouched. Warnings do not stop the chain, except that an `uncommitted` warning still outstanding at delivery stops the run `waiting` before anything is pushed. None of the work was undone — pi-crust cannot tell an agent's write from a developer's save in the same branch, so it names what it saw and leaves the tree alone. Empty for a run that saw nothing still worth saying.
- **`logs[].name`** — the event name, not just the payload. The console echoes every printed line as a `log` too, so a code activity run files its verdict under `step_result` and replay asks for it by that name. "The activity run's last log" is usually a human sentence.

`error`, `ended_at`, `started_at` and `resume_from` are omitted when absent — `JSON.stringify` drops undefined keys. Read them as optional.

`--resume` reads this same function (`readRunState`). There is one answer to "what is already done", and both callers read it, so the report and the resumed run cannot disagree.

## An attempt is an Activity Run

There is no `attempt` column, on any table. A re-executed Activity — a gate failure, a revise round, a regression — opens its own `activity_runs` row, so the thing being budgeted and the thing being recorded are the same thing. A build that retried twice shows three rows rather than one row with `attempt=3` in a column nobody read, and the row it replaced is marked `superseded` rather than rewritten.

A `fail` or `running` row is marked `superseded` once the trace holds a later row of the exact same instance name with status `running`, `success`, `fail` or `waiting`. Different occurrences such as `build` and `build_2` never replace one another. The replaced row keeps its recorded `error` and end time; a never-settled row without them receives an interruption explanation and an end time. Superseded rows remain readable but do not count towards the verdict, summary or delivery decision. A failure with no replacement still fails the run.

`latestByName` already selects the highest `seq` per name, so resume needs no change: the latest record per name is the one that counts.

An envelope is still persisted the moment it PARSES, not after its gates pass, so one Activity Run can write several `envelopes` rows when its JSON had to be corrected in session. The accepted one is the latest valid row for that Activity Run.

## Narration

Agents stream their reasoning and prose a few characters at a time. Those deltas accumulate and are written as one `narration` event per turn, per channel — reasoning and prose are separate, because they are read differently.

Every narration event and every tool call carries the turn that produced it. That is what lets a reader see which calls a passage of thinking caused: a trace interleaves several agents, so adjacency in time is not causation.

The database keeps a bounded tail per activity run. `raw_output.jsonl` keeps the complete text, so a long activity run can lose its earliest thinking from the UI while remaining whole on disk.

## Watching every repository

One viewer lists the newest 200 sessions in the shared trace, wherever it was launched. Each session displays its recorded repository, or `unknown` when no origin was recorded. The repository filter uses the full repository path, so repositories sharing a directory name stay distinct. Filtering narrows only those loaded sessions. The branch label uses the recorded branch, then the working-tree directory name, then `unknown`; it never borrows the viewer's launch directory.

```bash
crust observe
# Explicitly open an earlier per-repository trace:
CRUST_DATA_DIR=<repo>/.pi-crust/data crust observe
# Explicit additional stores remain supported:
CRUST_WORKSPACES=/trees/a,api=/trees/b crust observe
```

`--all-worktrees` remains an explicit sweep for sibling worktrees holding databases, not the default. A link can name its store with `#/<workspace>:<run_id>`; unqualified links search every watched store. Viewer actions take their working directory from the run's recorded origin or invocation, never from the shared database's directory. They use the server's own package runtime, or the runtime of the checkout `CRUST_HOME` names, and report a failure when that directory has no runtime.

`report` without a run id, `sessions`, `please` and `prune` act on the whole shared trace, not just the current repository. Prune remains dry by default.

## Ports

`[ports]` in the merged TOML configuration sets `backend` and `frontend`: package defaults first, machine settings under `~/.pi-crust/config/` next, the repository's `pi-crust.toml` last. `observe` and run links use the merged ports. Valid port variables below win over the configuration; malformed port variables leave its value in force.

| Variable           | Default                 | What it moves                             |
| ------------------ | ----------------------- | ----------------------------------------- |
| `CRUST_BE_PORT`    | `ports.backend` (4600)  | the API the UI and every run talk to      |
| `CRUST_FE_PORT`    | `ports.frontend` (4601) | the web app                               |
| `CRUST_WORKSPACES` | —                       | explicit stores to watch, comma-separated |

```bash
CRUST_BE_PORT=5600 CRUST_FE_PORT=5601 crust observe
```

Both are named rather than taking the conventional `PORT`, and there is no fallback to it. `PORT` is the variable most likely to already be set for something else in a repository full of servers, and when it is, the UI proxies to a port the API never bound — every request 404s with nothing explaining why.

A run prints `watch: http://localhost:<fe>/#/<run_id>` when the API answers a health probe at startup, and prints nothing when it does not. The probe proves the API is up rather than the UI; in the normal case they start together, and a link to a port nothing is listening on would teach a reader to ignore the next hint too.

## Forgetting runs

A trace row is small; a session directory is not. Eight trivial scout runs produced twelve megabytes, and a full lifecycle writes every agent's entire stream to `raw_output.jsonl`.

```bash
crust prune 14d          # say what would go
crust prune 14d --yes    # delete it
```

Rows and directories go together. Deleting one without the other leaves a trace that references transcripts that are gone, or gigabytes of transcripts no index can find — and the second is how a data directory ends up deleted wholesale, taking the run somebody needed with it.

Dry by default, because deleting a run cannot be undone, and an age is always required so that a bare `prune` can never mean "everything". A run that is still `running` or `waiting` is never pruned whatever its age: a waiting run is old precisely because it is waiting for you. A row with no start time is left alone too — a missing timestamp is damage, and the safe reading of damage is to leave it.

## Building a command by answering questions

`crust please` asks for the run instead of the flags. It opens with the run id, because that question subsumes the rest: naming a run that is waiting means you are continuing it, and the only thing left to ask is whether you are approving, answering or rejecting. Say nothing and it offers a new run instead — which Lifecycle or Activities, in what order, how much it may decide for itself, how it hands the work over, and where to stop and show you.

It ends by printing the command and offering to run it. The line is the point: `please` is a way to build a command, not a replacement for knowing them, and seeing the one you just described is how the flags stop needing the wizard. Choose "just give me the line" and nothing is started.

The menus move with the arrow keys or `j`/`k`, select with tab or space, `a` and `n` take or clear everything, enter confirms and escape backs out. A multi-select records the order you chose things in, because for a chain of Activities the order is what the chain means.

## Research, design, and letting it choose the chain

Seven Activities sit outside every Lifecycle, because they answer questions a lifecycle does not ask. Run them when the question is theirs.

Five of them are research disciplines — `technical-research`, `ux-research`, `domain-research`, `security-research`, `data-research`. Each establishes what is TRUE in its own subject and decides nothing, and each reports findings the same way: what was found, how it is known, how confident, and what contradicts it. `source` separates what was *observed* from what is *documented* from what was *inferred*, which is the distinction the whole exercise turns on — "the documentation says it retries" is not "it retries", and a design built on the second when only the first was established fails in production rather than in review. They are read-only; findings go to the session's handoff directory, never to the repository.

`data-research` deliberately has no database access. It writes the query and says what it expects, for a person to run — an agent deciding on its own to query a live store cannot see the load it would add or which replica it is really pointed at.

`ux-design` is not research: it decides. It produces an interface specification precise enough that an implementer invents no UX of their own, including every meaningful state, the keyboard and accessibility behaviour, and an explicit list of what was deliberately left open.

`operator` chooses the chain and performs none of it. It is handed a catalogue of the Activities that exist — generated from the Activity catalogue, never written into its prompt — and returns the smallest chain that can produce the outcome, with what it excluded and why. Its plan then becomes the rest of that same run, so the reasoning and the work it caused live in one trace.

Two things govern it. `steps_valid` rejects a plan naming an Activity that does not exist, or naming another operator, and hands the mistake back to the same session to fix. The trust dial decides whether the chain may run unseen: below 50 the run stops and shows you the chain it proposes before spending anything on them, and at 50 or above it runs them and reports the choice with everything else the run decided for itself. There is no `--execute` flag, because that question is already answered by the dial, and two controls for one intention is a mistake this factory has made before.

`operator` and `--activities` together are refused rather than reconciled. One asks the factory to choose the chain and the other names it; honouring either silently would mean guessing which you meant.

## Watching a run from another machine

From an installed pi-crust, `crust observe` handles arguments itself. It accepts `--host`, `--host <address>` (also `--host=<address>`) and `--strictPort`, and refuses `--open`. With no `--host`, both listeners bind only the loopback address; `--host` binds every interface and prints network addresses, while `--host <address>` binds only that address. One Node server serves the prebuilt UI and the API on both configured ports, with no bun or development server. `--strictPort` is accepted because an occupied port always fails.

From a contributor's clone, `crust observe` takes arguments and hands them to vite, the process serving the web app: `crust observe --host` listens on every interface so a phone or a second machine can watch a run, and `--host 127.0.0.1`, `--open` and `--strictPort` work the same way.

They go straight after the recipe with no `--` separator. `crust observe -- --host` does not work — the flag never reaches vite, which reports "use --host to expose" — which is the opposite of the habit most tools teach, so it is worth remembering once.

The arguments reach the web app only. The ports are configured by `[ports]` in TOML, or by `CRUST_BE_PORT` and `CRUST_FE_PORT`, because it is the thing behind the thing: flags belong to the process you are actually looking at, and an argument list that silently split between two processes would be worse than either.

## Archiving a run, and the token that lets you

The X on a dashboard card archives the run out of the review list. It is a WRITE, so the server refuses it without `CRUST_TOKEN` — like steering, answering a gate, or starting a run.

Start the server with the token and paste the same value when the dashboard asks:

```bash
CRUST_TOKEN=$(openssl rand -hex 16) crust observe
```

The page cannot know the token — it is a secret held by whoever started the server — so it asks only after a write is refused, and keeps it in that browser. Asking up front, on a dashboard whose reads need nothing, would teach people to paste secrets into any box that asks for one.

Started without `CRUST_TOKEN`, the server disables writes entirely and says so: `503`, and the dashboard tells you to restart it with one rather than asking for a token that would not help.
