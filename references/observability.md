# Observability Reference

The event schema, the seven SQLite tables, and the polling contract — the one data path is **agents → sqlite → web ui**.

## Two stores, one truth

**Files are the raw record** (`raw_output.jsonl` streams, `envelope.json`, `agent_map.json`); **SQLite (`crust.db`) is the queryable mirror** the UI reads. `trace-db.ts` writes both. Losing the db loses nothing that can't be rebuilt from files.

Location comes from `db` in `crust.observe.yaml`, default `.pi-crust/data/crust.db` — inside the **target** repo, gitignored.

## Event schema

`trace-db.ts` emits these types, every one logged against its `run_id` **and** `activity_run_id`:

| Type                 | Emitted when                                                                                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activity_run_start` | a `activity run(activityRunParams({...}), body)` block is entered                                                                                                                      |
| `agent_start`        | a coding agent is spawned or resumed for `callAgent(run, ph, {...})`                                                                                                                   |
| `tool_call`          | a tool (`read`, `bash`, `edit`, `write`) returns — **one event per real call**, named `bash: ls -la src`, payload `{tool, tool_call_id, args, result_snippet, ok, duration_ms, agent}` |
| `handoff`            | an envelope crosses from one agent to the next                                                                                                                                         |
| `gate_pass`          | a gate found no failed checks — payload carries `checks` (the evidence) and an empty `violations`                                                                          |
| `gate_fail`          | a gate found at least one failed check — payload carries `checks` and `violations`                                                                                         |
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

**A `tool_call` is the one event that spans time**, so it fills both `started_at` and `ended_at` on the row — the tool's real start and return. Every other type is a point in time: `started_at` is when it was recorded and `ended_at` stays NULL. Lay tool calls out on a time axis from those columns, never by parsing `payload_json` (`duration_ms` is in the payload too, as pi's own number, but it is a convenience, not the source for layout).

**Streaming is solved by construction.** `data/pi-agent.ts` tails pi's JSONL stdout line by line and the tracer inserts each event into `crust.db` **while the agent is still working** — never batched at activity run end (verified in the first smoke run: tool calls visible mid-run). Everything downstream is a poll → render.

## Tables

```sql
sessions (
  run_id        TEXT PRIMARY KEY,
  request       TEXT,              -- the engineer's ask
  status        TEXT,              -- running | success | fail
  engineer      TEXT,
  started_at    TEXT, ended_at TEXT,
  total_tokens  INTEGER, total_cost REAL
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

**A hung agent emits nothing**, which is exactly when you need its pid: no events, no tokens, no output to read. `processes` is the only table that can answer "what is this run running, and how do I stop it" — `just crust procs <run_id>` lists what is live, `just crust kill <run_id>` stops children before the parent, and both verify the recorded `command` still matches the pid before signalling it. A killed run finalizes its own trace: SIGTERM and SIGINT are turned into `SystemExit` in `session.ensure`, so the session lands on `fail` with its process rows closed instead of reading `running` forever.

**Derived, never stored:** activity run durations (`ended_at − started_at`), session activity run-progress (query `activity-runs` by `run_id`), lane layout (`kind` + `owner`).

Activity Run status invariants: `queued` only for manifest-declared activity runs not yet entered (dashed in the UI); `running` on enter; only a clean exit writes `success` — agent activity runs additionally need the envelope parsed and gates green; everything else resolves to `fail`. `blocked` and `cancelled` are not activity run rows: nothing started, so there is nothing to open a row for. They arrive as `activities_blocked` and `activities_cancelled` events naming what the run did not reach and why — blocked when a person is holding it and the work is still owed, cancelled when it is not coming. Without them a halted run leaves everything downstream with no record at all, which reads the same as a lifecycle that never had those Activities.

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

Live view polls on a rowid cursor every `poll_ms` in `crust.observe.yaml` (default 500):

```sql
SELECT ... FROM events WHERE run_id = ? AND rowid > ? ORDER BY rowid LIMIT 500;
```

Keep the highest `rowid` returned as the next cursor. History is **the same queries** with filters, lazy-paged as the engineer scrolls or drills in — one mechanism serves both live and past runs, which is why there is no separate replay path.

## The run reporter

```text
bun .pi-crust/report.ts [<run-id>] [--json] [--db <path>] [--config <path>]
```

No `run-id` means the most recent session. `--db` wins over the config's `observability.db`, which is read from `crust.observe.yaml`. The connection is opened **readonly** with a busy timeout, so asking where a run got to never blocks a run that is still writing.

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
  "lifecycle": "sdlc",
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
  "envelopes": [
    { "activity run": "build", "agent": "builder", "output_type": "BuildOutput",
      "valid": true, "payload": { … } }
  ]
}
```

Three fields carry the weight:

- **`completed`** — activity run names whose LATEST record is `success`. A session that ran `build` twice and failed the second time does not list `build`; the latest record per name wins, which is what makes resume correct across a joined session.
- **`resume_from`** — the first activity run, in `seq` order, whose latest record is not success. `undefined` (absent from the JSON) means every activity run succeeded and there is nothing to resume.
- **`logs[].name`** — the event name, not just the payload. The console echoes every printed line as a `log` too, so a code activity run files its verdict under `step_result` and replay asks for it by that name. "The activity run's last log" is usually a human sentence.

`error`, `ended_at`, `started_at` and `resume_from` are omitted when absent — `JSON.stringify` drops undefined keys. Read them as optional.

`--resume` reads this same function (`readRunState`). There is one answer to "what is already done", and both callers read it, so the report and the resumed run cannot disagree.

## An attempt is an Activity Run

There is no `attempt` column, on any table. A re-executed Activity — a gate failure, a revise round, a regression — opens its own `activity_runs` row, so the thing being budgeted and the thing being recorded are the same thing. A build that retried twice shows three rows rather than one row with `attempt=3` in a column nobody read, and the row it replaced is marked `superseded` rather than rewritten.

`latestByName` already selects the highest `seq` per name, so resume needs no change: the latest record per name is the one that counts.

An envelope is still persisted the moment it PARSES, not after its gates pass, so one Activity Run can write several `envelopes` rows when its JSON had to be corrected in session. The accepted one is the latest valid row for that Activity Run.

## Narration

Agents stream their reasoning and prose a few characters at a time. Those deltas accumulate and are written as one `narration` event per turn, per channel — reasoning and prose are separate, because they are read differently.

Every narration event and every tool call carries the turn that produced it. That is what lets a reader see which calls a passage of thinking caused: a trace interleaves several agents, so adjacency in time is not causation.

The database keeps a bounded tail per activity run. `raw_output.jsonl` keeps the complete text, so a long activity run can lose its earliest thinking from the UI while remaining whole on disk.

## Watching several working trees

One page, however many trees you have agents running in. Each tree keeps its own trace database beside its own work; the observer merges them for display and writes back to whichever tree a run actually belongs to.

A tree registers itself the first time a lifecycle runs in it, and the observer watches every registered tree by default. Nothing has to be named on the command line, and a tree added while the UI is running appears within a poll rather than needing a restart — which matters because the moment you add a worktree is the moment you are least willing to restart the thing you are watching.

Registration is a file the run writes, not a call to the observer. The first run in a new tree is both the one most worth watching and the one that happens before anybody opens the UI, so registration has to work when nothing is listening: an API call would need the server already up, on a known port, with a token, and would lose exactly that run.

```bash
just crust trees                      # the trees this machine has run in
just crust forget-tree /path/to/tree  # stop watching one
```

Forgetting is always explicit. A tree whose database cannot be opened right now looks exactly like one on an unmounted volume or one that has simply moved, so an unreachable tree stays listed and says so rather than disappearing on its own.

To watch a specific set instead of everything registered, name them — the flag wins over the registry, and both forms accept a tree or a database path:

```bash
just crust observe                                    # every registered tree
CRUST_WORKSPACES=/trees/a,api=/trees/b just crust observe
```

The registry only ever contains trees where the factory has actually run, so watching all of them cannot sprawl into unrelated checkouts. A tree that has never run pi-crust is invisible, deliberately: `--all-worktrees` sweeps sibling git worktrees for databases as a one-off repair for a machine whose registry was deleted, and is not the normal path.

In the UI, a run's tree is a chip on its card and a filter above the list, both of which appear only when more than one tree is being watched. A link carries the tree when it is known — `#/<workspace>:<run_id>` — and an unqualified link still works: the server finds the run across every tree it watches.

## Ports

The ports are a committed answer with an environment escape hatch. `ports.backend` and `ports.frontend` in `.pi-crust/config/crust.observe.yaml` are what `observe` boots on and what a run assumes when it prints a link; the variables below win over the file, for a clash that is not worth committing.

| Variable           | Default                        | What it moves                                            |
| ------------------ | ------------------------------ | -------------------------------------------------------- |
| `CRUST_BE_PORT`    | `ports.backend` (4600)         | the API the UI and every run talk to                     |
| `CRUST_FE_PORT`    | `ports.frontend` (4601)        | the web app                                              |
| `CRUST_WORKSPACES` | —                              | trees to watch, comma-separated, instead of the registry |
| `CRUST_REGISTRY`   | `~/.pi-crust/workspaces.jsonl` | where registration is recorded                           |

```bash
CRUST_BE_PORT=5600 CRUST_FE_PORT=5601 just crust observe
```

Both are named rather than taking the conventional `PORT`, and there is no fallback to it. `PORT` is the variable most likely to already be set for something else in a repository full of servers, and when it is, the UI proxies to a port the API never bound — every request 404s with nothing explaining why.

A run prints `watch: http://localhost:<fe>/#/<run_id>` when the API answers a health probe at startup, and prints nothing when it does not. The probe proves the API is up rather than the UI; in the normal case they start together, and a link to a port nothing is listening on would teach a reader to ignore the next hint too.

## Forgetting runs

A trace row is small; a session directory is not. Eight trivial scout runs produced twelve megabytes, and a full lifecycle writes every agent's entire stream to `raw_output.jsonl`.

```bash
just crust prune 14d          # say what would go
just crust prune 14d --yes    # delete it
```

Rows and directories go together. Deleting one without the other leaves a trace that references transcripts that are gone, or gigabytes of transcripts no index can find — and the second is how a data directory ends up deleted wholesale, taking the run somebody needed with it.

Dry by default, because deleting a run cannot be undone, and an age is always required so that a bare `prune` can never mean "everything". A run that is still `running` or `waiting` is never pruned whatever its age: a waiting run is old precisely because it is waiting for you. A row with no start time is left alone too — a missing timestamp is damage, and the safe reading of damage is to leave it.

## Building a command by answering questions

`just crust please` asks for the run instead of the flags. It opens with the run id, because that question subsumes the rest: naming a run that is waiting means you are continuing it, and the only thing left to ask is whether you are approving, answering or rejecting. Say nothing and it offers a new run instead — which lifecycle or steps, in what order, how much it may decide for itself, how it hands the work over, and where to stop and show you.

It ends by printing the command and offering to run it. The line is the point: `please` is a way to build a command, not a replacement for knowing them, and seeing the one you just described is how the flags stop needing the wizard. Choose "just give me the line" and nothing is started.

The menus move with the arrow keys or `j`/`k`, select with tab or space, `a` and `n` take or clear everything, enter confirms and escape backs out. A multi-select records the order you chose things in, because for a chain of steps the order is what the chain means.

## Research, design, and letting it choose the chain

Seven steps sit outside every lifecycle, because they answer questions a lifecycle does not ask. Run them when the question is theirs.

Five of them are research disciplines — `technical-research`, `ux-research`, `domain-research`, `security-research`, `data-research`. Each establishes what is TRUE in its own subject and decides nothing, and each reports findings the same way: what was found, how it is known, how confident, and what contradicts it. `source` separates what was *observed* from what is *documented* from what was *inferred*, which is the distinction the whole exercise turns on — "the documentation says it retries" is not "it retries", and a design built on the second when only the first was established fails in production rather than in review. They are read-only; findings go to the session's handoff directory, never to the repository.

`data-research` deliberately has no database access. It writes the query and says what it expects, for a person to run — an agent deciding on its own to query a live store cannot see the load it would add or which replica it is really pointed at.

`ux-design` is not research: it decides. It produces an interface specification precise enough that an implementer invents no UX of their own, including every meaningful state, the keyboard and accessibility behaviour, and an explicit list of what was deliberately left open.

`operator` chooses the chain and performs none of it. It is handed a catalogue of the steps that exist — generated from the registry and the roster, never written into its prompt — and returns the smallest chain that can produce the outcome, with what it excluded and why. Its plan then becomes the rest of that same run, so the reasoning and the work it caused live in one trace.

Two things govern it. `steps_valid` rejects a plan naming a step that does not exist, or naming another operator, and hands the mistake back to the same session to fix. The trust dial decides whether the chain may run unseen: below 50 the run stops and shows you the steps it proposes before spending anything on them, and at 50 or above it runs them and reports the choice with everything else the run decided for itself. There is no `--execute` flag, because that question is already answered by the dial, and two controls for one intention is a mistake this factory has made before.

`operator` and `--steps` together are refused rather than reconciled. One asks the factory to choose the chain and the other names it; honouring either silently would mean guessing which you meant.

## Watching a run from another machine

`just crust observe` takes arguments and hands them to vite, the process serving the web app: `just crust observe --host` listens on every interface so a phone or a second machine can watch a run, and `--host 127.0.0.1`, `--open` and `--strictPort` work the same way.

They go straight after the recipe with no `--` separator. `just crust observe -- --host` does not work — the flag never reaches vite, which reports "use --host to expose" — which is the opposite of the habit most tools teach, so it is worth remembering once.

The arguments reach the web app only. The API behind it is configured by `ports:` in `crust.observe.yaml`, or by `CRUST_BE_PORT` and `CRUST_FE_PORT`, because it is the thing behind the thing: flags belong to the process you are actually looking at, and an argument list that silently split between two processes would be worse than either.

## Archiving a run, and the token that lets you

The X on a dashboard card archives the run out of the review list. It is a WRITE, so the server refuses it without `CRUST_TOKEN` — like steering, answering a gate, or starting a run.

Start the server with the token and paste the same value when the dashboard asks:

```bash
CRUST_TOKEN=$(openssl rand -hex 16) just crust observe
```

The page cannot know the token — it is a secret held by whoever started the server — so it asks only after a write is refused, and keeps it in that browser. Asking up front, on a dashboard whose reads need nothing, would teach people to paste secrets into any box that asks for one.

Started without `CRUST_TOKEN`, the server disables writes entirely and says so: `503`, and the dashboard tells you to restart it with one rather than asking for a token that would not help.
