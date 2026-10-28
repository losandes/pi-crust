# Fix: no Activity spawns an agent the factory cannot see

## Objective

No shipped or stamped Activity loads `harness-engineering/subagents.ts`, names a `subagent_*` tool, or carries a prompt section telling an agent to fan out recon. The extension file stays in the package, type-checked and usable from interactive pi, but nothing in a run reaches it. A test fails if any Activity wires it back in.

This removes a capability that spawned real, billed, untraced agents whose output never reached the agent that spawned them. It does not change the extension, the trace, the visualizer, or any other Activity's configuration.

## 1. Requirements

### 1.1 The roster stops offering the tools

1.1.1 The `plan` entry in `templates/stamp/config/crust.activities.yaml` MUST lose its `harness_engineering` key and the four `subagent_create`, `subagent_continue`, `subagent_list`, `subagent_remove` entries from its `tools` list. Every other key of that entry — `model`, `thinking`, `color`, `purpose`, `prompt_engineering`, `gates`, `output`, `writes`, and the `bash`, `edit`, `read`, `write` tools — MUST be unchanged.

1.1.2 The `scout` entry in the same file MUST lose the same key and the same four tool entries, with the same preservation of everything else.

1.1.3 `.pi-crust/config/crust.activities.yaml` MUST receive the identical edits. It is this repository's own stamped roster, it is what this repository's runs actually read, and `install.ts` never overwrites `config/` — so editing only the template leaves the behaviour in place here.

1.1.4 No other Activity in either file MUST gain `harness_engineering` or a `subagent_*` tool as part of this work.

1.1.5 The `harness_engineering` key MUST remain supported by the configuration schema and by `validate-agents.ts`. This spec removes two uses of a mechanism; it does not remove the mechanism.

### 1.2 The prompts stop instructing it

1.2.1 The `## Subagents` section of `runtime/prompt-engineering/plan/system.md` MUST be deleted in full — the heading, the paragraph naming the four tools, and the paragraph beginning "They run in the background", which contains the instruction "Wait for every one you spawned to report before writing `plan.md` or your Report JSON."

1.2.2 The `## Subagents` section of `runtime/prompt-engineering/scout/system.md` MUST be deleted in full, including its equivalent wait instruction.

1.2.3 No file under `runtime/prompt-engineering/` MUST mention a subagent after this work.

1.2.4 The tool removal in 1.1.1 and 1.1.2 and the prompt removal in 1.2.1 and 1.2.2 MUST land in the same change. `--tools` filters extension tools, so removing the tool names while leaving the prompt produces an agent told to use tools it does not have — which is the hallucination this work exists to stop, not a safer intermediate state.

### 1.3 The extension survives, unreferenced

1.3.1 `runtime/harness-engineering/subagents.ts` MUST NOT be deleted. It registers the `/sub`, `/subcont`, `/subrm` and `/subclear` commands for interactive pi, where its widget rendering and its follow-up delivery both work, and it is the starting point for [FEATURE-OBSERVABLE-SUBAGENTS.md](../someday/FEATURE-OBSERVABLE-SUBAGENTS.md) should that be executed later.

1.3.2 `scripts/typecheck-harness.ts` MUST continue to include `harness-engineering/` in the project it checks. An unreferenced file that stops being compiled rots.

1.3.3 The file's header comment MUST state that no Activity in the shipped configuration loads it, that it is an interactive-pi extension, and that loading it from a batch Activity produces an agent whose work is untraced and whose results do not reach its parent. One short paragraph, placed with the existing usage note.

1.3.4 A test MUST fail when any Activity in `templates/stamp/config/crust.activities.yaml` declares a `harness_engineering` entry ending in `subagents.ts`, or names a tool matching `subagent_`. It MUST assert over the shipped configuration as loaded, not over the file as text, so a roster that reaches the same state by another route is also caught.

## 2. Target state

The two registry entries, stated once. Where this and the prose in section 1 disagree, section 1 governs. Comments and the surrounding entries are unchanged; only the removals shown here are made.

```yaml
  - name: plan
    output: planOutput
    gates: [artifactsExist, filesNonEmpty]
    model: anthropic/claude-opus-5
    thinking: high
    color: violet
    purpose: Turn a request into a plan the builder can implement without asking questions.
    prompt_engineering:
      system: prompt-engineering/plan/system.md
      user: prompt-engineering/plan/user.md
    writes:
      - "{handoff}/plan.md"
    tools:
      - bash
      - edit
      - read
      - write

  - name: scout
    output: scoutOutput
    gates: [artifactsExist]
    color: orange
    purpose: Find and report where things live; change nothing.
    prompt_engineering:
      system: prompt-engineering/scout/system.md
      user: prompt-engineering/scout/user.md
    writes: ['{handoff}/scout_findings.md']
    tools:
      - bash
      - edit
      - read
      - write
```

## 3. Out of scope

- **The extension's behaviour.** `subagents.ts` is not fixed, not refactored, and not partially repaired. Its results still arrive by `pi.sendMessage` and its widgets still render for a TUI. Nothing in this spec touches its body.
- **Result delivery.** The file-based result contract described in [FEATURE-OBSERVABLE-SUBAGENTS.md](../someday/FEATURE-OBSERVABLE-SUBAGENTS.md) is not implemented here, not even in part. Half of it costs the same review and buys nothing while the tools are unreachable.
- **The trace and the visualizer.** No schema change, no new event type, no `parent_id` use, no UI work.
- **`path-policy.ts` and the other harness extensions.** The extension mechanism and every other use of it are unchanged.
- **The models, thinking levels, colours and purposes** of `plan` and `scout`. A roster edit that removes four tool names must not also retune the Activity.
- **The existing sessions under `.pi-crust/data/`.** Past runs recorded subagent tool calls; those rows stay exactly as they are. Nothing in this work rewrites history.
- **`crust.activities.local.example.yaml` and the other example configs**, unless one of them names a `subagent_*` tool, in which case 1.1.4 applies to it.

## 4. Work stages

| #   | Change                                                                          | Proven by                                                                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 1.1.1–1.1.5, 1.2.1–1.2.4, 2 — the roster and prompt removals, together          | `grep -rn "subagent" templates/stamp/config .pi-crust/config runtime/prompt-engineering` exits 1                                                                                                                                             |
| 2   | 1.3.3, 1.3.4 — the header paragraph and the test that keeps the roster honest   | `cd runtime && bun test modules/use-cases/shipped-config.test.ts`                                                                                                                                                                            |
| 3   | 1.3.1, 1.3.2 — confirm the extension is still present and still compiled        | `bun scripts/typecheck-harness.ts`; `test -f runtime/harness-engineering/subagents.ts`                                                                                                                                                       |
| 4   | Whole-repository verification before the work is reported done                  | `(cd runtime && bun test && bun x tsc --noEmit)`; `(cd apps/visualizer && bun test && bun x tsc --noEmit && bun x vite build)`                                                                                                               |
| 5   | A live `scout` run reaches its envelope with no subagent tool call in the trace | `just crust run "where is the trace database opened" --activities scout`, then `sqlite3 -readonly .pi-crust/data/crust.db "select count(*) from events where name like 'subagent%' and started_at > datetime('now','-1 hour');"` returns `0` |

Stage 1 is one change rather than two because 1.2.4 forbids landing either half alone. Stage 5 runs last because it is the only stage that spends money, and the three before it make its result interpretable.

## 5. Rationale

**The capability has never worked in a run.** Two sessions in this repository's trace used it — `81a2d702_02_plan` and `b6f8f617_02_plan` — and in both the planner spawned subagents, polled `subagent_list` until they reported `DONE`, and never received their output. In the first it improvised a workaround, calling `subagent_continue` with "Resend your complete briefing verbatim as your reply. Do not re-investigate; just output the report text you already produced." In the second it gave up after six minutes and re-did the recon itself with greps. Both runs paid for three Opus subagents at high thinking and used nothing they produced.

**The cause is structural, not a bug to patch here.** `subagent_create` returns only a spawn confirmation, and `subagent_list` returns status and the task text — never the output. The one path for the result is `pi.sendMessage(..., { deliverAs: 'followUp' })`, which pi queues for delivery after the current turn ends, so a polling agent mid-turn cannot see it. The agent's conclusion that nothing arrived was a correct inference from the tools it had.

**The prompt makes it worse than useless.** Both system prompts instruct the agent to wait for every subagent to report before writing its artifact. An agent that obeys an instruction to wait for a message that never visibly arrives spends its turn budget waiting.

**Why the file stays.** Deleting it would discard a working interactive extension and the only existing implementation of child-agent spawning, stream parsing and session continuation in this repository. The defect is in loading it from a batch Activity, which is a configuration fact, so the fix belongs in configuration.

**Why a test rather than a comment.** The `harness_engineering` key remains supported and the extension remains on disk, so the configuration that caused this is one line away at all times. A header paragraph explains the rule to somebody already reading the file; the test catches the person who was not.

**Rejected: fixing delivery instead.** A file-based result contract would be roughly forty lines and would let the planner read what its subagents found. It was rejected for this spec because it does not satisfy the requirement that a subagent's thinking be visible in the visualizer — the children would still run unobserved, producing artifacts whose reasoning nobody can inspect. Satisfying that requirement is [FEATURE-OBSERVABLE-SUBAGENTS.md](../someday/FEATURE-OBSERVABLE-SUBAGENTS.md), which is substantially larger than this spec. These two specs are alternatives; exactly one is executed.

**Rejected: leaving it enabled pending the larger work.** Every `plan` and `scout` run between now and then spends three Opus subagents' worth of tokens on recon that is discarded. The roster edit is reversible in one commit if the larger work is chosen later.
