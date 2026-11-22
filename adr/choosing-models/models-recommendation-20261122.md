# Model recommendation, 22 November 2026

## Status

proposed

## What this supersedes, and why

[models-recommendation-20261115.md](models-recommendation-20261115.md) bound every OpenAI row to GPT-6.1 Sol. GPT-6.2 Sol, released 17 November 2026 at the same token prices, replaces it on every one of those rows at the same thinking level. It also drops `test-tdd`, which is no longer an Activity in the roster. Nothing else changes: the groups, the reasoning about effort, and every Anthropic binding stand as written there.

The replacement is forced by the record's own precondition rather than chosen. On Cognition's FrontierCode 2.0, as re-scored on 17 November and recorded in [system-card-breakdown.csv](system-card-breakdown.csv), GPT-6.1 Sol is beaten or nearly matched at every setting by a GPT-6.2 Sol setting that costs about the same or less:

| Effort   | GPT-6.1 Sol    | GPT-6.2 Sol    |
| -------- | -------------- | -------------- |
| `low`    | 25.74 at $0.34 | 33.14 at $0.40 |
| `medium` | 30.27 at $0.49 | 38.29 at $0.69 |
| `high`   | 35.09 at $0.65 | 39.72 at $0.88 |
| `xhigh`  | 33.03 at $0.69 | 39.78 at $0.98 |
| `max`    | 39.65 at $1.03 | 43.76 at $1.29 |

A model off the cost-versus-score frontier has no right effort level, so GPT-6.1 Sol leaves the roster. GPT-6.2 Sol at `max` also comes within a point of GPT-6.2 Astra's best (44.19 at $5.97) for under a quarter of the cost.

Thinking levels were held deliberately. The 15 November record lowered effort because the benchmark's curve did not describe these Activities, and a stronger model at the same setting does not reopen that argument.

## The bindings

Rows marked changed, and the removal of `test-tdd`, are the only differences from the superseded record.

| Activity             | Model                        | Thinking | Group      | Changed |
| -------------------- | ---------------------------- | -------- | ---------- | ------- |
| `plan`               | `anthropic/claude-fable-5-2` | `high`   | Decide     |         |
| `identify`           | `anthropic/claude-fable-5-2` | `high`   | Decide     |         |
| `conceptualize`      | `anthropic/claude-fable-5-2` | `high`   | Decide     |         |
| `design`             | `anthropic/claude-fable-5-2` | `high`   | Decide     |         |
| `ux-design`          | `anthropic/claude-fable-5-2` | `high`   | Decide     |         |
| `domain-research`    | `anthropic/claude-fable-5-2` | `high`   | Research   |         |
| `technical-research` | `anthropic/claude-fable-5-2` | `high`   | Research   |         |
| `security-research`  | `anthropic/claude-fable-5-2` | `high`   | Research   |         |
| `data-research`      | `anthropic/claude-fable-5-2` | `high`   | Research   |         |
| `ux-research`        | `anthropic/claude-fable-5-2` | `high`   | Research   |         |
| `code-review`        | `anthropic/claude-opus-5-5`  | `medium` | Judge      |         |
| `outcome-review`     | `anthropic/claude-opus-5-5`  | `medium` | Judge      |         |
| `plan-readiness`     | `anthropic/claude-opus-5`    | `high`   | Judge      |         |
| `plan-comprehension` | `openai/gpt-6.2-sol`         | `medium` | Judge      | yes     |
| `operator`           | `anthropic/claude-opus-5-5`  | `medium` | Judge      |         |
| `triage`             | `anthropic/claude-opus-5-5`  | `medium` | Judge      |         |
| `diagnose`           | `anthropic/claude-opus-5-5`  | `medium` | Judge      |         |
| `build`              | `openai/gpt-6.2-sol`         | `medium` | Execute    | yes     |
| `test`               | `openai/gpt-6.2-sol`         | `medium` | Execute    | yes     |
| `scout`              | `openai/gpt-6.2-sol`         | `medium` | Execute    | yes     |
| `document`           | `openai/gpt-6.2-sol`         | `low`    | Synthesize | yes     |
| `gh-issue`           | `openai/gpt-6.2-sol`         | `low`    | Synthesize | yes     |
| `gh-pull-request`    | `openai/gpt-6.2-sol`         | `low`    | Synthesize | yes     |

The reason for each unchanged row is in the superseded record's own bindings table. `plan-comprehension` stays on OpenAI for the reason given there under "Why the plan reviewers differ": its reviewer must not share the planner's training, and GPT-6.2 Sol preserves that.

## Where GPT-6.2 Sol was considered and not used

**The Judge rows stay on Claude Opus 5.5.** FrontierCode puts GPT-6.2 Sol at `medium` ahead of Opus 5.5 at `medium` — 38.29 at $0.69 against 31.43 at $1.70 — but that benchmark scores producing a mergeable change, not judging one. Moving `code-review` would also put the reviewer in the same model family as `build`, which settles the record's open question on reviewer independence by accident rather than by measurement.

**The Decide and Research rows stay on Claude Fable 5.2.** These were chosen on knowledge minus hallucination, and GPT-6.2 Sol did not improve there. Artificial Analysis carries its AA-Omniscience index at 40.4 against 42.0 for GPT-6.1 Sol and 64 for Fable 5.2, with a hallucination rate of 55.4% against 51.9% for GPT-6.1 Sol. OpenAI's system card reports the same direction: both GPT-6.2 models scored lower than their predecessors on expressing uncertainty, and "sometimes treated an unconfirmed detail as fact".

**GPT-6.2 Astra does not enter the roster.** It leads the human-preference board for 3D and interactive builds, AA-3D, at 1318 against Fable 5.2's 1271, which keeps Fable second on the axis `ux-design` was once chosen for. On FrontierCode no Astra setting beats GPT-6.2 Sol at `max` by more than half a point, at three to five times the cost.

## What to watch

**Unreported obstacles in Execute Activities.** OpenAI's GPT-6.2 system card reports that both GPT-6.2 models omit an obstacle that blocked their work from their final answer more often than their predecessors, and that its mitigation is an instruction in the Codex developer prompt, which is not applied to direct API requests. Every Activity this record moves to GPT-6.2 Sol is reached through the API. In this repository the final answer is the report envelope, and nothing currently asks an Activity for obstacles met during its own work. `build` and `test` are backstopped by their `checks` gate; `scout` is not, so a false success there propagates. If an Execute Activity reports success on work a later Activity finds incomplete, this is the first cause to check.

**Instruction-following and laziness.** On OpenAI's simulated internal Codex traffic, GPT-6.2 Sol drew instruction-following flags on 4.66% of turns against 3.21% for GPT-6.1 Sol, and laziness flags on 5.25% against 3.32%, while drawing fewer high-severity flags. The stronger benchmark score and the weaker adherence pull in opposite directions on `build`, and only this repository's traces can say which wins: first-attempt `checks` pass rate on `build`, before and after this change.

Everything the superseded record lists under its own "What to watch" still applies, except its `test-tdd` item, which left with the Activity.
