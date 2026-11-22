---
name: pi-crust
description: pi-crust — deploy and operate repeatable agents-plus-code lifecycles in any codebase, written in TypeScript and stamped into .pi-crust/. Use when the user says /skill:pi-crust install, wants to create, run, or update a workflow, manage the agent roster in crust.config.yaml, or observe a running agent workflow. Keywords - pi-crust, crust, software factory, AI developer workflow, agent pipeline, install factory, run_id, trace db.
argument-hint: "[install | create workflow | run workflow | update config | ...]"
---

# pi-crust: AI Software Factory

Reusable combination of **agents plus code**: deterministic TypeScript workflow scripts own sequencing, retries, and acceptance; coding agents (Pi in v1) work inside bounded activity runs; typed JSON envelopes carry context between them; everything streams into SQLite for the polled visualizer. Agent proposes, code disposes.

## Use this skill when

- The engineer says `/skill:pi-crust install`, or asks to set the factory up in a repository
- A stage or a lifecycle needs creating, changing, or running — the definitions in `.pi-crust/config/crust.lifecycles.yaml` or the entry points under `<pi-crust>/runtime/commands/`
- The agent roster needs tuning: a model, a thinking level, a tool list, a `writes` boundary
- A run needs watching or explaining — which activity run failed, what a gate rejected, what it cost
- Someone asks what `.pi-crust/` is, or how to drive it

## Do not use this skill for

- Planning or scoping work that is not a factory workflow — use `planning-work`
- The older Python factory in `adws/` and its skill — use `sssf`; the two coexist and this skill never touches that tree
- Reviewing the code a run produced — use `code-review`
- Doing the work a workflow exists to do. You launch and observe; you never implement, plan, or test in an agent's place

## Startup

Three steps. Then stop.

1. Read [cookbooks/crust_overview.md](cookbooks/crust_overview.md) — the system map.
2. Run `just crust help` — every recipe this factory offers, plus the Lifecycles and the Activities this repository actually offers (`just crust list` prints the narrower, Lifecycles-and-Activities-only view). They are configuration, so this file cannot tell you what they are, and there is no recipe named after any of them.
3. Print what is available as a table — name, the chain, one line on when to reach for it — and **wait for the engineer's request.**

The two directories are not the same kind of thing, and the table should not pretend otherwise:

```text
| Lifecycle | Chain | Use when |
|---|---|---|
| tdd | identify → conceptualize → plan → design → test-tdd → build → outcome-review → code-review | the tests should be written before the thing they prove |
| sdlc | identify → conceptualize → plan → design → build → test → outcome-review → code-review | the work starts from a wish and its shape is not obvious |
| bugfix | diagnose → plan → test → build → outcome-review → code-review | the work starts from a symptom somebody reported |
| de-risk | identify → plan → build | the expensive question is whether the approach works at all |
| run | whatever `--activities` names | you know exactly which Activities you want |

| Activity | Purpose | Use when |
|---|---|---|
| scout | find and report where things live | read-only recon; nothing changes |
| diagnose | reproduce a reported behaviour and name its cause | the report is a symptom |
```

Take the rows from the two config files, never from this list: a team adds, removes and renames Activities without touching this package, so a table written here is a table that drifts.

Every Activity runs on its own, and `run --activities a,b,c` runs any ordered subset of them in any order, with repeats; `a+b` runs two at once. Say so when you print the table: an engineer who wants only a code review should not be told to run a lifecycle, and one who wants an unusual order does not need a new file written for them.

**Nothing else.** No trace-db queries, no reading the config or the workflow scripts' bodies, no repo inventory, no last-runs summary, no diagnosing an old failure, no "current state" dashboard. None of it was asked for, and it is not free:

- **Volunteered state is guessed state.** An orchestrator that improvised a status board queried a `runs` table and a `payload` column — neither exists (`sessions`, `payload_json`). The spec that would have said so is `references/observability.md`, one lazy read away. Probing to look prepared is how you end up confidently wrong in your first message.
- **It spends the context the real task needs**, before you know what the task is.
- **It is stale on arrival.** State printed before the request describes a system that the very next run changes.

Everything else — the db schema, the roster, the handoff contract — is lazy-loaded through the routing table below, when a request actually calls for it. Reading it early defeats the mechanism.

Two exceptions, both narrow: if the engineer's first message already contains a request, skip the waiting and route it; and if the factory is plainly not installed (no `.pi-crust/`), say that in one line instead of the table.

## Orchestrator rules

You run the system, observe the system, and help the user interact with it. **You do no workflow work yourself:**

- Never implement, plan, or test in an agent's place — launch the workflow and watch it.
- Never edit files inside `.pi-crust/data/sessions/` — that is the run record.
- Observe by querying `.pi-crust/data/crust.db` (WAL — reads never block writers) **when observing is the task**. This is a capability, not a startup step: query it to follow a run you launched or one the engineer asked about, never to volunteer a status report nobody requested.
- Report activity run status plainly: name, owner, status, error if any.

## Request routing (lazy-load the cookbook, then follow it)

| Request                                                                                    | Cookbook                                                                                                                                                  |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/skill:pi-crust install`, set up the factory in this repo                                 | [cookbooks/install.md](cookbooks/install.md)                                                                                                              |
| add a lifecycle                                                                            | [cookbooks/create_lifecycle.md](cookbooks/create_lifecycle.md)                                                                                            |
| change a lifecycle's stages or concurrency                                                 | [cookbooks/update_lifecycle.md](cookbooks/update_lifecycle.md)                                                                                            |
| create the config / agent roster                                                           | [cookbooks/create_config.md](cookbooks/create_config.md)                                                                                                  |
| add or retune an agent (model, thinking, tools, prompts)                                   | [cookbooks/update_config.md](cookbooks/update_config.md)                                                                                                  |
| extend `<pi-crust>/runtime/domains/` or `<pi-crust>/runtime/lib/` with new low-level logic | [cookbooks/update_modules.md](cookbooks/update_modules.md)                                                                                                |
| run / monitor a workflow                                                                   | [cookbooks/how_to_prompt_for_the_eng.md](cookbooks/how_to_prompt_for_the_eng.md) **first**, then [cookbooks/run_lifecycle.md](cookbooks/run_lifecycle.md) |
| turn a request into a workflow prompt                                                      | [cookbooks/how_to_prompt_for_the_eng.md](cookbooks/how_to_prompt_for_the_eng.md)                                                                          |

Deep specs, when needed: [references/config.md](references/config.md) · [references/handoff.md](references/handoff.md) · [references/observability.md](references/observability.md)

## Lifecycle stages

The chain follows the lifecycle in `adr/context/sdlc.md`. The stage numbers are that record's; the Activity names are what you type. They differ in one place, and the mapping is kept rather than renamed so a human running the same lifecycle recognises both.

| Stage             | Activity                        | Reduces                                                          |
| ----------------- | ------------------------------- | ---------------------------------------------------------------- |
| 1.1 Evaluate      | `scout`                         | what is happening, what is known versus believed                 |
| 1.2 Identify      | `identify`                      | what outcome is wanted, how success is recognised                |
| 1.3 Conceptualize | `conceptualize`                 | what the solution must mean and do                               |
| 2.1 Plan          | `plan`                          | what to build, in what order, proven how                         |
| 2.2 Design        | `design`                        | how it physically exists here, observability included            |
| 2.3 Build         | `test-tdd` or `test`, `build`   | what would prove it, and the work; the `checks` gate rules on it |
| 3.1 Verify        | `outcome-review`, `code-review` | is it what was asked for; does it conform                        |
| 3.2 Launch        | `document` + a human            | handing a reviewable change to the person who launches it        |

An Activity is named for the WORK, and IS its agent: `crust.activities.yaml` holds both halves of it — the model, tools, writes and prompts that say who performs it, and the `output`, `attempts` and `commit` that say what the work is. The engine attaches [output checks](references/config.md#output-checks) from `output`. There is no second registry and no performer to bridge to.

`scout` is stage 1.1. It kept its name because every chain, recipe and habit already uses it, and a rename would cost more than the tidiness is worth — but it is Evaluate, and the record's rules for Evaluate are the ones it follows.

Stages may send the run BACKWARDS. Any stage can set `regress_to` when evidence invalidates earlier work: a builder that finds the design cannot work has found something, and `conceptualize` should hear it rather than `build` burying it in a workaround. A lap is an Activity Run of the destination, so it comes out of that instance's `attempts` — the same budget a failed gate and a revise round spend from. When it is gone, the developer is asked, with an itemised account of where it went.

## The five scripts

Each does one thing, and each is invoked by path. `<pi-crust>` below is this skill's own directory, whose absolute path is in the skill listing — pi-crust is a package and may be installed anywhere, so there is no fixed path to quote:

| Task                                                                       | Command                                                                 |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Stamp the factory into the current repo; `--refresh` template-owned files. | `bun <pi-crust>/scripts/install.ts`                                     |
| Prove the installed `.pi-crust/` is the tree this skill ships              | `<pi-crust>/scripts/verify-install.sh`                                  |
| Write just the roster, when the rest is already there                      | `bun <pi-crust>/scripts/make-config.ts`                                 |
| Add a Lifecycle or an Activity                                             | edit `.pi-crust/config/crust.lifecycles.yaml` / `crust.activities.yaml` |
| Boot the trace UI against a stamped tree (what `just crust observe` runs)  | `bun <pi-crust>/scripts/observe.ts`                                     |

`install.ts --refresh` replaces existing template-owned files, including `.example.yaml` documents under `config/`. `--force` is a deprecated alias through 0.1.x, scheduled for removal in 0.2.0. A missing `config/` is seeded on first install; once it exists, non-example files are neither added nor overwritten. New examples are added even without flags and reported separately from replacements. Adopt new settings files deliberately — see [cookbooks/install.md](cookbooks/install.md).

Run `verify-install.sh` after installing and after any change to the template. The skill is the source and `.pi-crust/` is a copy, so an edit made to one and not the other ships a factory that differs from the one it was tested in, and nothing says so until a run behaves strangely. It exempts `config/` (the repository's own roster and routing), `data/` (runtime), and tests, which `install.ts` never stamps.

`install.ts` stamps `.pi-crust/` — the activity registry, the lifecycles, the themes, a prompts directory for yours, and `data/` for this machine's runs. No code is stamped: the runtime lives in the package, which is what lets an update replace everything it owns without touching anything a team wrote. It also appends three gitignore lines and a `crust` passthrough recipe to the root justfile, so the recipes land as `just crust <recipe>` without colliding with recipes the repository already has.

## Hard rules (enforced across everything the factory generates)

1. **Validate before running** — every workflow declares `REQUIRED_AGENTS` and calls `validateAgents()` first; a missing or misnamed agent fails before anything spawns.
2. **Typed outputs only** — every agent call pairs with a concrete envelope spec in `<pi-crust>/runtime/lib/contracts/src/envelope.ts`; parse failures re-prompt the same session (context intact), never restart. **The output contract is a synced triad**: (a) the schema in `typedefs/envelope.ts`, (b) the JSON example in the agent's `user.md` `## Report` section, (c) `outputType:` at every call site. These are ONE contract — change any one, update all three in the same edit (grep the spec name to find every call site).
3. **Gates validate claims, not guesses** — `gate.check(envelope, run, changedPaths) -> TGateReport`. The engine derives [output checks](references/config.md#output-checks) from the Activity's envelope spec; the driver judges them at the Unit boundary, and a failure re-runs the Activity with the violations in its prompt, which spends one of its `attempts`. `checks` is the gate that runs this repository's own commands, and it waits for the Stage boundary because a concurrent sibling may still be writing.
4. **Four-param rule** — any function with more than 4 parameters takes one concrete type instead (`TAgentCall`, `TActivityRunParams` are the pattern).
5. **One agent, one prompt, one purpose** — identity lives in `system.md`; task shape (user prompt + output type) lives at the call site.
6. **Workflow scripts stay thin** — all low-level logic lives in `<pi-crust>/runtime/domains/` and `<pi-crust>/runtime/lib/`, split `typedefs/` (shapes), `data/` (the outside world), `use-cases/` (policy).
7. **Every activity run earns a description** — one sentence on what it does and why, never a restatement of its name. It is the only intent the trace, the console, and the UI ever show; `commit_plan: "Commit the plan"` is rejected at construction, blank is too.
8. **A known command is a gate, not an agent** — if you can write the invocation down (`bun test`, `pnpm lint`), it belongs in `routing.checks` and reaches a run as the `checks` gate. The engine attaches it to `buildOutput` Activities except `test-tdd`; see [output checks](references/config.md#output-checks). Agents are for the parts that need reading and deciding; the failures come back to the Activity that produced the work.
9. **`tools:` is a capability list, `writes:` is the boundary, and the working tree is the developer's** — `bash` runs anything (including `git checkout`) and `write` reaches any path, so a tool list can never make "this agent changes nothing" true. Two mechanisms, and the difference between them is attribution. `defaults.protected_files` and gitignored paths are governed by `defaults.protected` and `defaults.ignored` and enforced BEFORE the call, in `<pi-crust>/runtime/extensions/path-policy.ts`, because a tool call belongs to the agent that made it and a secret that has been read cannot be unread; the shipped default is `block` both ways for a protected path, and `warn`/`block` for a gitignored one. `writes:` per agent is observed AFTER the call in `<pi-crust>/runtime/domains/policy/src/use-cases/enforce-permissions.ts`, and an overstep is reported, never reverted: a developer editing the same branch is indistinguishable from an agent in a diff, and `git checkout --` has no undo. The session runtime under `data_dir` is always writable and never governed — a read-only agent is read-only with respect to the REPO, never mute. `bash` is best-effort only; if a path must not leak, do not give that Activity `bash`.
10. **Every workflow ends in `finish(run)`** — activity runs passing is not the same as the run being accepted. A test activity run that ran a red suite succeeded at its job. Pass `accepted:` so the exit code, the session status, and the banner are decided together and cannot disagree.
11. **Repository commands are config-routed, never hardcoded** — checker commands belong in `routing.checks` in `crust.config.yaml`, selected by the paths a change actually touched. Skills belong where the coding agent discovers them; the engine does not route them.
12. **A verification nobody declared did not pass** — when paths changed and no `routing.checks` rule matched them, the `checks` gate FAILS and says so. Zero checks passing is not the same claim as zero checks failing.
14. **The harness settles a dispute, neither agent** — a chain ending in Activities that declare `output: reviewOutput` feeds their blocking findings back to the Activity that wrote the work, as a `revise` Activity Run, bounded by that Activity's `attempts`. The builder may answer a finding with evidence instead of a fix, under three rules the harness applies: a finding a `routing.checks` entry decides may not be disputed at all; a dispute must carry a `path:line` or a command and its exit status, or `disputes_supported` rejects it as the refusal it is; and a finding raised twice with no new evidence on either side ends the loop and lands in `context_handoff/disputes.md` for the developer. The repeat count is the harness's, read from a persisted ledger — an agent that decides when the argument is over has decided its own case.

13. **Resume is a flag, not a workflow** — `--resume` with `--run-id` skips the activity runs already recorded successful for that session. It reads the same `readRunState` the reporter reads, so `bun .pi-crust/report.ts` and the resumed run can never disagree about what is done.

## Where a run stopped

`bun .pi-crust/report.ts [<run-id>] [--json]` answers it: activity runs and their status, the gate that failed with its violations, the cost, the first activity run not yet successful, and the exact command that picks the run back up. `--json` emits `TRunState` for an agent to parse — the shape is specified in [references/observability.md](references/observability.md). Exit codes: `0` succeeded, `1` failed or incomplete, `2` no such session.

## v1 scope

Pi coding agent only (`coding_agent: pi`), default model `gemini-3.6-flash` via openrouter, thinking `medium`. `claude_code` is schema-valid but stubbed until v2. The stamped tree is pure TypeScript run by bun, with exactly one runtime dependency (`zod`). The visualizer lives in `apps/visualizer/` and polls the same trace db the sqlite queries read.
