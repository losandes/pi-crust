# Model recommendation, 15 November 2026

## Status

proposed

## What this supersedes, and why

[models-recommendation-20261114.csv](models-recommendation-20261114.csv) derived every binding from published benchmarks. Running it surfaced two problems that no benchmark could have told us.

**Effort was set by analogy.** The only per-effort data available — Cognition's FrontierCode 2.0, recorded in [system-card-breakdown.csv](system-card-breakdown.csv) — measures an agent producing a mergeable code diff from an issue description, working autonomously with no human in the loop. Most Activities here do nothing of the sort. Applying that curve to planning, research and prose Activities was an argument, not a measurement, and it put six of them at `xhigh`.

**The benchmark and lived experience diverge for a reason, not by accident.** FrontierCode scores the outcome; a developer experiences the process. Reasoning budget buys recovery from wrong turns in a loop nobody is watching — and in an Activity whose decisions were already made upstream, it is spent re-litigating them instead. That is the same argument this repository's record already makes for implementation Activities; it extends further than the record first allowed.

The correction was one rung, not two. An earlier draft of this table capped every Activity at `medium`, concluded that Claude Fable 5.2 had no measured advantage at that setting, and dropped it entirely. The cap was invented rather than observed: the reported problem was `xhigh`, and every Fable measurement — FrontierCode 45.29, AA-Omniscience 64 against Opus 5.5's 48, HLE-with-tools 74.2% against 67.7% — sits at `high`, which is also its vendor default. Fable belongs where the decisions and the research are, at `high` and never above.

## How the roster is grouped

Bindings follow what an Activity *does* rather than where it sits, which is the record's first criterion stated more usefully.

| Group      | Activities                                                                                                | What it needs                                                                                                   |
| ---------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Decide     | `plan`, `identify`, `conceptualize`, `design`, `ux-design`                                                | The strongest available judgement. Short documents, nominal gates, and every later Activity inherits the result |
| Research   | `domain-research`, `technical-research`, `security-research`, `data-research`, `ux-research`              | Resistance to confident invention. Bounded by source quality rather than by reasoning depth                     |
| Judge      | `code-review`, `outcome-review`, `plan-readiness`, `plan-comprehension`, `operator`, `triage`, `diagnose` | Comparison against a stated standard — bounded judgement, not open-ended reasoning                              |
| Execute    | `build`, `test`, `test-tdd`, `scout`                                                                      | Fidelity across a long tool loop. The decisions were made upstream, so budget here re-opens them                |
| Synthesize | `document`, `gh-issue`, `gh-pull-request`                                                                 | Almost nothing. A transform of outputs that already exist                                                       |

## The bindings

| Activity             | Model                        | Thinking | Group      | Why                                                                                          |
| -------------------- | ---------------------------- | -------- | ---------- | -------------------------------------------------------------------------------------------- |
| `plan`               | `anthropic/claude-fable-5-2` | `high`   | Decide     | Most decisions in the chain are made here and nothing mechanical checks them                 |
| `identify`           | `anthropic/claude-fable-5-2` | `high`   | Decide     | Turns a request into the criteria everything downstream is judged against                    |
| `conceptualize`      | `anthropic/claude-fable-5-2` | `high`   | Decide     | Logical architecture; overlaps planning and is read by every later Activity                  |
| `design`             | `anthropic/claude-fable-5-2` | `high`   | Decide     | Physical shape of the solution; same leverage as planning                                    |
| `ux-design`          | `anthropic/claude-fable-5-2` | `high`   | Decide     | Second on frontend preference boards while leading the research measures outright            |
| `domain-research`    | `anthropic/claude-fable-5-2` | `high`   | Research   | Leads knowledge-minus-hallucination by a wide margin, which is this group's failure mode     |
| `technical-research` | `anthropic/claude-fable-5-2` | `high`   | Research   | As above; repository code is primary evidence and a wrong claim propagates unchecked         |
| `security-research`  | `anthropic/claude-fable-5-2` | `high`   | Research   | Must separate demonstrated from speculative, which is the same axis                          |
| `data-research`      | `anthropic/claude-fable-5-2` | `high`   | Research   | Prepares queries nobody runs against a live database; a wrong premise is invisible           |
| `ux-research`        | `anthropic/claude-fable-5-2` | `high`   | Research   | Distinguishing a user need from a proposed feature is a hallucination-adjacent judgement     |
| `code-review`        | `anthropic/claude-opus-5-5`  | `medium` | Judge      | Reads a diff against ratified records; comparison rather than open-ended reasoning           |
| `outcome-review`     | `anthropic/claude-opus-5-5`  | `medium` | Judge      | Confirms the work matches the request; the standard is stated, not discovered                |
| `plan-readiness`     | `anthropic/claude-opus-5`    | `high`   | Judge      | Checks the plan against the working tree with a shell; its gate only checks verdict shape    |
| `plan-comprehension` | `openai/gpt-6.1-sol`         | `medium` | Judge      | See "Why the plan reviewers differ" below                                                    |
| `operator`           | `anthropic/claude-opus-5-5`  | `medium` | Judge      | Chain selection from a fixed menu over a short context, on every run                         |
| `triage`             | `anthropic/claude-opus-5-5`  | `medium` | Judge      | Same, and a person reads the result before anything executes                                 |
| `diagnose`           | `anthropic/claude-opus-5-5`  | `medium` | Judge      | Research over code, with reproduction evidence holding it honest                             |
| `build`              | `openai/gpt-6.1-sol`         | `medium` | Execute    | Implements a plan; best measured mergeability per dollar, and the plan paid for the deciding |
| `test`               | `openai/gpt-6.1-sol`         | `medium` | Execute    | Proves an implemented request; decisions already made                                        |
| `test-tdd`           | `openai/gpt-6.1-sol`         | `medium` | Execute    | Same family of work, before the implementation exists                                        |
| `scout`              | `openai/gpt-6.1-sol`         | `medium` | Execute    | Retrieval. The next Activity discovers a miss by opening the file                            |
| `document`           | `openai/gpt-6.1-sol`         | `low`    | Synthesize | Writes up a diff that already exists                                                         |
| `gh-issue`           | `openai/gpt-6.1-sol`         | `low`    | Synthesize | Assembles findings the chain already produced                                                |
| `gh-pull-request`    | `openai/gpt-6.1-sol`         | `low`    | Synthesize | Describes a branch that already exists                                                       |

`low` is what the lowest rung of a vendor's interactive thinking control maps to in the API — the setting a developer reaches for when the research is done and only the writing is left.

## Why the plan reviewers differ

`plan-comprehension` and `plan-readiness` run concurrently and look like one job. They are not.

`plan-comprehension` judges the document and is forbidden a shell: it may not open a source file, and wanting to open one is itself the finding. Its validity therefore depends on the reviewer **not** sharing the planner's training — a plan that is clear to one model family is exactly the failure this Activity exists to catch. Putting it on a different maker from `plan` is the premise of the Activity, not a preference about prose.

`plan-readiness` checks the plan against the repository with a shell, blocking on paths that do not exist and steps no command can settle. Its findings are factual, so shared blind spots matter less, and it keeps a top model at `high` because its gate checks only the shape of a verdict.

## Deliberate exclusions

**Gemini 4 Argon leaves the roster.** It held the three Synthesize Activities on human-preference writing scores and a low guess-rate on unknowns. It is replaced by direct experience of the same task shape, which is better targeted even though the published evidence is broader. Revisit if issue and pull-request bodies start reading thin.

**GPT-6 Astra leaves the roster.** It held `ux-design` on frontend preference alone. Fable 5.2 is second on that axis and first on the research measures, so one model now covers both.

**Nothing is set above `high`.** `xhigh` and `max` appear nowhere, including on Activities whose measured optimum is higher. That is a deliberate trade of measured autonomous-task score against observed behaviour on this repository's work.

## What to watch

`test-tdd` is grouped with execution but writes the tests that define correctness, before any implementation exists, and it has no `checks` gate for that reason. If its tests come back shallow or tautological, it is the first row to raise.

Ten Activities on Fable 5.2 is a real premium per token. It is bounded because those Activities write documents rather than loop over a repository, but a lifecycle running several research Activities plus planning and design pays it repeatedly. The cheapest retreat is the five Research rows to Opus 5.5 at `medium`, keeping Fable where the decisions are.

None of this is measured on this repository's work. The number that would settle the most consequential row — `plan` — is first-attempt gate pass rate on `build` across two configurations, which the trace database already records.
