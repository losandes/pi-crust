# Feature: a subagent thinks out loud into the trace

## Objective

Every agent a run spawns — including one spawned by another agent — narrates into `crust.db` and appears, attributed and live, in the visualizer's narration pane. A subagent's result is a durable file in the run's session directory that its parent reads with the tool it already has, rather than a message delivered at a turn boundary nobody can observe. A subagent runs under the same path policy as the agent that spawned it and cannot spawn another.

The baseline for this work is the repository **after** [FIX-DISABLE-SUBAGENTS.md](FIX-DISABLE-SUBAGENTS.md) has been executed: no Activity names a `subagent_*` tool or loads the extension, neither system prompt has a `## Subagents` section, a test fails if either is wired back in, and `runtime/harness-engineering/subagents.ts` is present, compiled, and unreferenced by any run. Re-enabling the capability is therefore part of this work, and section 1.8 says so and says it goes last.

This adds observation and a result contract to an extension that currently runs only in interactive pi. It does not change the trace schema, resume semantics, or what an Activity is, and it restores the capability to exactly the two Activities that had it.

## 1. Requirements

### 1.1 The child must stream its reasoning, or this work stops

1.1.1 Before any other stage, it MUST be established whether the pi invocation used to spawn a subagent emits reasoning events on its stream. The disable spec left the extension's body untouched apart from its header comment, so the invocation at `runtime/harness-engineering/subagents.ts` is still `pi --mode json -p --no-extensions --tools read,bash,grep,find,ls --thinking <level> <prompt>`, and its stream is still parsed by `processLine`, which keeps `message_update.assistantMessageEvent.text_delta` and counts `tool_execution_start`.

1.1.2 The subagent MUST be spawned with an invocation that emits reasoning events. Print mode is permitted only if stage 1 demonstrates that it emits them; otherwise the spawn MUST move to the RPC invocation that `runtime/modules/data/pi-agent.ts` already uses for every other agent in a run.

1.1.3 If neither invocation emits reasoning events, the remaining requirements MUST NOT be implemented, and the finding MUST be recorded here as an amendment naming what pi would have to expose. A subagent whose thinking cannot be captured does not satisfy the objective, and a partial implementation that traces tool calls alone would read as success.

### 1.2 The extension relays; it never records

1.2.1 `processLine` MUST append every line it receives from the child, verbatim and unparsed, to a per-subagent file named `<id>.jsonl` inside the directory named by the `CRUST_SUBAGENT_DIR` environment variable.

1.2.2 The extension MUST NOT open `crust.db`. The trace has one writer, that writer is the runtime, and an extension loaded into pi runs under node where `bun:sqlite` is unavailable.

1.2.3 When `CRUST_SUBAGENT_DIR` is unset — interactive pi, where the widgets are the point and which is the only way the extension is reached at the time this work starts — the extension's behaviour MUST be unchanged: widgets, `ctx.ui.notify`, and the existing `pi.sendMessage` delivery.

1.2.4 Lines received on the child's stderr MUST be relayed too, distinguishable from stdout lines, so a child that died of a bad flag leaves evidence rather than silence.

1.2.5 The child invocation MUST NOT load `harness-engineering/subagents.ts`. A subagent cannot spawn a subagent, and the enforcement is that the tools are absent from the child rather than a rule in a prompt.

1.2.6 The child invocation MUST load `harness-engineering/path-policy.ts`, resolved the same way `execute-agent.ts` resolves it, so a subagent is refused the paths its parent is refused. This replaces the present `--no-extensions`, which was what made the policy absent.

### 1.3 The runtime records what the relay leaves

1.3.1 `execute-agent.ts` MUST pass `CRUST_SUBAGENT_DIR` to the pi subprocess in the same `env` it already passes `policy.env` through, pointing at `<sessionDir>/<agent>/subagents/`, created before the agent starts.

1.3.2 The runtime MUST watch that directory while the parent agent runs, and MUST flush whatever remains after the parent exits. A subagent's last passage of reasoning is not less real for arriving late.

1.3.3 Each relayed line MUST be fed through the narration tracker in `runtime/modules/data/pi-agent.ts`, one tracker instance per subagent, so the passage-joining, turn numbering and per-activity-run size cap behave for a subagent exactly as they do for an agent.

1.3.4 Every emitted event MUST carry `activity_run_id` equal to the parent activity run's — a subagent belongs to the Activity that spawned it, not to a new one — and `payload.agent` equal to `<parent agent name>` followed by a separator and the subagent number.

1.3.5 Every emitted event MUST carry `parent_id` equal to the `event_id` of the `subagent_create` tool call that spawned it. The column exists in the schema and is written as `input.parent_id ?? ''` today; this is its first use and requires no migration.

1.3.6 The runtime MUST correlate a subagent's relay file to its spawning tool call by the number pi-crust already records in that call's result — the text `Subagent #N spawned`. If 1.1.2 changes the spawn such that a more direct correlation is available, that MUST be used instead.

1.3.7 The child's token usage MUST be recorded on an event, so a plan that cost three subagents is not reported at the parent's cost alone.

1.3.8 A subagent still running when its parent exits MUST produce an event saying so. It MUST NOT be silently dropped, and the parent activity run's own settlement MUST NOT change because of it.

### 1.4 A result is a file, not a message

1.4.1 When a child exits, its accumulated output MUST be written to `<sessionDir>/<agent>/subagents/<id>.md`.

1.4.2 `subagent_list` MUST report, per subagent, its status, its elapsed seconds, and the path from 1.4.1 once that path exists. The task text MAY be truncated; the path MUST NOT be.

1.4.3 The descriptions of `subagent_create` and `subagent_continue` MUST describe the contract the parent can rely on: spawn, continue working, poll `subagent_list`, read the file when it appears. The present sentence "Returns immediately and delivers results as a follow-up message" MUST be removed, because it promises a delivery the parent cannot observe mid-turn.

1.4.4 The existing `pi.sendMessage` follow-up MAY remain. Nothing in the parent's instructions MUST depend on it.

### 1.5 The visualizer shows it

1.5.1 `apps/visualizer/src/components/NarrationPane.tsx` MUST render subagent narration attributed to the name from 1.3.4, visually subordinate to the parent agent's own narration and interleaved in time with it.

1.5.2 The colour MUST derive from the parent Activity's configured colour. The agent registry has no entry for a subagent, so a lookup by name MUST NOT be the mechanism.

1.5.3 Each subagent's narration MUST be collapsible, and MUST default to expanded. Three parallel subagents are noisy; a reader who cannot see them by default has the problem this feature exists to solve.

1.5.4 Subagent narration MUST appear during the run, at the polling cadence the pane already uses, with no new API endpoint.

### 1.6 The prompts describe the contract that exists

1.6.1 A `## Subagents` section MUST be written afresh in `runtime/prompt-engineering/plan/system.md` and `runtime/prompt-engineering/scout/system.md`. The disable spec deleted both, so this is authoring rather than editing, and the deleted text MUST NOT be restored verbatim.

1.6.2 Each section MUST describe the loop in 1.4.2 and 1.4.3: spawn, continue your own work, poll `subagent_list`, read the result file when its path appears. It MUST tell the agent to read the result files before writing its artifact, and to record in its artifact any subagent whose file never appeared.

1.6.3 Neither section MUST tell an agent to wait for a subagent to report. That instruction, which both prompts carried before the disable spec removed them, is what made a planner spend its turn budget waiting for a message it could not see.

### 1.7 Tests

1.7.1 A test MUST show that the relay writes received lines verbatim when `CRUST_SUBAGENT_DIR` is set, and writes nothing when it is unset.

1.7.2 A test MUST show, from a captured child stream held as a fixture, that the runtime emits narration events carrying the attribution of 1.3.4 and the `parent_id` of 1.3.5.

1.7.3 A test MUST cover 1.3.8: a relay file whose child never finished still yields events, and the parent's settlement is unaffected.

1.7.4 A test MUST show the visualizer rendering attributed subagent narration subordinate to its parent, against a fixture trace.

### 1.8 The capability is re-enabled, last

1.8.1 The `plan` and `scout` entries in `templates/stamp/config/crust.activities.yaml` MUST regain the `harness_engineering` key naming `harness-engineering/subagents.ts` and the four `subagent_create`, `subagent_continue`, `subagent_list`, `subagent_remove` tool entries that [FIX-DISABLE-SUBAGENTS.md](FIX-DISABLE-SUBAGENTS.md) removed. No other Activity MUST gain them.

1.8.2 `.pi-crust/config/crust.activities.yaml` MUST receive the identical restoration. `install.ts` never overwrites `config/`, and that file is what this repository's own runs read.

1.8.3 The guard test that [FIX-DISABLE-SUBAGENTS.md](FIX-DISABLE-SUBAGENTS.md) added — failing when any Activity declares a `harness_engineering` entry ending in `subagents.ts` or names a tool matching `subagent_` — MUST be replaced rather than deleted. Its replacement MUST fail when an Activity names a `subagent_*` tool without declaring the extension that registers it, or declares the extension without naming the tools: `--tools` filters extension tools, so either half alone produces an agent instructed to use tools it does not have.

1.8.4 The header paragraph that [FIX-DISABLE-SUBAGENTS.md](FIX-DISABLE-SUBAGENTS.md) added to `runtime/harness-engineering/subagents.ts`, stating that no Activity loads it and that loading it produces untraced work, MUST be replaced by one describing the relay contract: the file named by `CRUST_SUBAGENT_DIR`, the runtime as the only writer of the trace, and the result file the parent reads.

1.8.5 Restoration MUST be the last change made before verification. Until 1.2 through 1.5 are in place, an Activity holding these tools spawns agents nobody can observe, which is the state the disable spec existed to remove.

## 2. Target state

The shape of one emitted subagent narration event, stated once. Where this and the prose in section 1 disagree, section 1 governs.

```ts
run.tracer.event({
  run_id: run.runId,
  // The Activity that spawned it. A subagent is not an activity run.
  activity_run_id: activityRun.activity_run_id,
  // The subagent_create tool call this child came from. First use of the column.
  parent_id: spawnEventId,
  type: 'narration',
  name: `${agentName}▸${subagentId} ${record.channel}`,
  started_at: record.started_at,
  ended_at: record.ended_at,
  payload: { ...rest, text: record.text, agent: `${agentName}▸${subagentId}` },
})
```

The directory the relay and the runtime share, below the run's session directory:

```text
.pi-crust/data/sessions/<run_id>/<agent>/
├── envelope.json
├── raw_output.jsonl
├── pi_sessions/
└── subagents/
    ├── 1.jsonl        relay: the child's stream, verbatim
    ├── 1.md           result: what the child finally said
    ├── 2.jsonl
    └── 2.md
```

## 3. Out of scope

- **The trace schema.** `parent_id` already exists and is already written. No migration, no new column, no new table.
- **`activity_runs` rows for subagents.** A subagent MUST NOT become an activity run. `readRunState` decides what `--resume` replays from those rows, and a subagent appearing there would change what resume skips.
- **Resume.** A resumed activity run replays its recorded result; it does not re-run subagents and does not reconcile their files. Nothing in this work touches `resume-run.ts`.
- **Which Activities may use subagents.** `plan` and `scout` regain exactly what they lost, under 1.8.1; no other Activity gains them. Extending the set is a roster decision, not this work.
- **The disable spec's other effects.** Everything [FIX-DISABLE-SUBAGENTS.md](FIX-DISABLE-SUBAGENTS.md) did that is not named in 1.8 stands. In particular, its requirement that the extension file be kept and kept compiled is not revisited, and `harness_engineering` remains a supported configuration key.
- **Nested subagents.** Forbidden by 1.2.5. Making depth configurable is not part of this work.
- **The interactive widget path.** `/sub`, `/subcont`, `/subrm`, `/subclear` and the widget rendering stay exactly as they are, guarded by 1.2.3.
- **Context-window economics.** This feature is justified by observability and by recon artifacts that survive the turn, not by context saving. Do not add summarisation, truncation tuning, or compaction behaviour on that argument.
- **The `--tools` list given to a child.** `read,bash,grep,find,ls` is unchanged by this work; 1.2.6 adds an extension, not a tool.
- **Re-litigating the disable.** [FIX-DISABLE-SUBAGENTS.md](FIX-DISABLE-SUBAGENTS.md) is executed and complete; this spec is its sequel, not its reversal. Do not restore anything it removed except what 1.8 names, and do not treat its removals as mistakes to undo.

## 4. Work stages

| #   | Change                                                                                             | Proven by                                                                                                                                                                                                                                            |
| --- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 1.1.1 — settle whether the child streams reasoning; record the answer in this spec                 | `pi --mode json -p --thinking high "think step by step about what 2+2 is, then answer" \| jq -r 'select(.type=="message_update") \| .assistantMessageEvent.type' \| sort -u` lists a thinking or reasoning delta                                     |
| 2   | 1.1.2, 1.2.5, 1.2.6 — the spawn invocation: reasoning on the stream, path policy on, subagents off | `cd runtime && bun test && bun x tsc --noEmit`; `bun scripts/typecheck-harness.ts`                                                                                                                                                                   |
| 3   | 1.2.1, 1.2.3, 1.2.4, 1.3.1, 1.7.1 — the relay and the directory the runtime names                  | `cd runtime && bun test modules/use-cases/execute-agent.test.ts`                                                                                                                                                                                     |
| 4   | 1.3.2–1.3.8, 1.7.2, 1.7.3 — the tailer, the tracker, the events                                    | `cd runtime && bun test`                                                                                                                                                                                                                             |
| 5   | 1.4.1–1.4.4 — results as files, `subagent_list` reporting paths, honest descriptions               | `bun scripts/typecheck-harness.ts`; `cd runtime && bun test`                                                                                                                                                                                         |
| 6   | 1.6.1–1.6.3 — the two prompt sections, written afresh                                              | `grep -n "subagent_list" runtime/prompt-engineering/plan/system.md runtime/prompt-engineering/scout/system.md` exits 0; `grep -rn "Wait for every one you spawned" runtime/prompt-engineering` exits 1                                               |
| 7   | 1.5.1–1.5.4, 1.7.4 — attribution, colour, collapsing, live arrival                                 | `cd apps/visualizer && bun test && bun x tsc --noEmit && bun x vite build`                                                                                                                                                                           |
| 8   | 1.8.1–1.8.5 — restore the roster entries, replace the guard test and the header paragraph          | `cd runtime && bun test modules/use-cases/shipped-config.test.ts`; `grep -c subagent_create templates/stamp/config/crust.activities.yaml .pi-crust/config/crust.activities.yaml` reports one per file                                                |
| 9   | Whole-repository verification                                                                      | `(cd runtime && bun test && bun x tsc --noEmit)`; `(cd apps/visualizer && bun test && bun x tsc --noEmit && bun x vite build)`; `bun scripts/typecheck-harness.ts`                                                                                   |
| 10  | A live run proves a subagent narrated into the trace                                               | `just crust run "where is the trace database opened, and where is it read" --activities scout`, then `sqlite3 -readonly .pi-crust/data/crust.db "select count(*) from events where type='narration' and parent_id != '';"` returns a positive number |

Stage 1 gates everything after it: 1.1.3 says what happens if it fails, and the remaining stages are not started until it passes. Stage 2 lands before stage 3 because the relay must relay the stream the final invocation produces, not the one being replaced. Stage 7 comes after stage 4 because the pane is built against events that exist.

Stage 8 is the last change, and stage 10 is the first moment a subagent runs inside an Activity since the disable landed. Everything before stage 8 is unreachable from a run, which is the point: restoring the roster earlier reopens the window [FIX-DISABLE-SUBAGENTS.md](FIX-DISABLE-SUBAGENTS.md) closed, and the fixtures in stages 3, 4 and 7 prove the machinery without a live subagent existing.

## 5. Rationale

**Why this follows the disable rather than reversing it.** [FIX-DISABLE-SUBAGENTS.md](FIX-DISABLE-SUBAGENTS.md) stopped a capability that spawned billed, untraced agents whose output never reached their parent. It deliberately kept the extension file, the `harness_engineering` configuration key and the harness type-check, so the cost of coming back is a roster edit and two prompt sections — which is all section 1.8 is. Nothing here argues the disable was wrong; it argues the capability is worth having once it can be watched.

**The subagents already narrate; nobody listens.** `processLine` parses the child's full event stream and keeps two things — text deltas and a tool-start counter. Reasoning, tool names, tool arguments and usage all arrive and are discarded. The feature is mostly a matter of not throwing them away.

**Why the extension relays rather than writes.** An extension that opened `crust.db` would be a second writer to a single-writer store, would need `node:sqlite` because pi runs on node while the runtime runs on bun, and would put trace-schema knowledge in a file that ships into a different process. Relaying raw lines to a file keeps every schema decision in the runtime, which is where the tracer and the narration tracker already live.

**Why `parent_id` rather than a new activity run.** The column is in the schema and has been written empty since it was added. Using it gives real nesting — an event knows which `subagent_create` produced it — without touching `activity_runs`, which `readRunState` and `--resume` read to decide what has already succeeded. A subagent recorded as an activity run would change what a resumed run skips, which is a far larger blast radius than this feature is worth.

**Why results became files.** The delivery the extension still performs is `pi.sendMessage(..., { deliverAs: 'followUp' })`, which pi queues for after the current turn. A parent polling mid-turn therefore sees `DONE` and cannot read anything. The two uses recorded in this repository's trace before the capability was disabled — `81a2d702_02_plan` and `b6f8f617_02_plan` — ended with the parent concluding the results never arrived; one re-asked each child to resend its briefing verbatim, the other abandoned the fan-out and re-did the recon with greps. A file is readable with the `read` tool the parent already has, survives turn boundaries and compaction, and leaves the recon beside the plan it informed.

**Why stage 1 is a gate rather than an assumption.** The requirement that a subagent's thinking be observable cannot be met if the child's invocation does not emit reasoning events. Discovering that after the tailer, the pane and the fixtures are written would mean a feature that traces tool calls and calls itself observable.

**Rejected: a blocking `subagent_run` that returns the child's output as its tool result.** It would make delivery trivially reliable, and it was rejected because the only argument for keeping the call asynchronous — the parent continuing to work while children run — is the argument for having subagents at all. A blocking call is a slower single agent.

**Rejected: restoring the roster first, to shorten the feedback loop.** Driving each stage from a live `plan` run would be easier to work against, and it is rejected because it reopens the window the disable closed: every run in the interim spends Opus subagents whose output nobody can read. Fixtures cost more to write and keep the capability off until it works.

**Rejected: deleting the disable spec's guard test rather than replacing it.** That test fails the moment the roster is restored, so deleting it is the path of least resistance. The failure it watches for — tools and extension out of step in either direction — is what produced an agent reasoning about subagents it could not call, so 1.8.3 keeps a test on that boundary instead of removing the only thing looking at it.
