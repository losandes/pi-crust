---
Context: All apps
---

# Envelope succession

## Status

accepted

## Decision

An Activity's output either **supersedes** the envelopes before it or **annotates** them, and which one is a declared property of the Activity rather than a consequence of where it sits in the chain. The default is derived from what an Activity already declares, so the property never becomes a second classification nobody maintains: an Activity whose output is a review verdict annotates, and every other Activity supersedes.

The envelope a consumer reads as its single input — `previous`, what an agent is shown as `previous_envelope` — is the most recent **superseding** envelope, never merely the most recent one. An annotating envelope travels alongside that input rather than displacing it.

The whole run's envelope history is available to an Activity that asks for it, bounded to the latest envelope per Activity Run, so a revise loop that re-runs the same Activity under numbered instances cannot grow the history without limit. A consumer sees that history only if its own prompt renders it, so the rule changes what is AVAILABLE to an Activity, not what every existing Activity already reads.

Three alternatives were considered and rejected, and the reasons are in Context:

| Rejected                                                                      | Instead                                                                                          |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| A per-consumer declaration of the envelope types an Activity consumes         | The existing output declaration already says whether an Activity judges; succession reads that   |
| A filename convention a consumer looks for (such as `plan.md`)                | One channel every Activity already receives, rather than a naming contract authors must remember |
| Leaving the serial fold in place and repairing each consumer's prompt instead | One rule in the engine, read once, rather than reasserted per prompt                             |

A fourth classification — four Activity roles, named **designer**, **producer**, **arbiter**, and **reporter** — was considered as the mechanism succession could have been built on, and was not adopted. It is recorded here as an alternative, not as vocabulary this repository now uses: a role answers what an Activity is FOR, succession answers whether its output replaces or comments on what came before, and the registry holds Activities — `scout`, `diagnose`, `document`, the research Activities, and the Planners — that no role cleanly covers. A classification that drives behaviour has to be right for all of them, and a wrong one is silent rather than loud. Part of why it does not fit: an arbiter-shaped Activity rules on a dispute, but deciding WHEN an argument ends is not a role an Activity can hold — the harness counts the repeats and ends the loop itself, which `revise-loop.ts`'s deadlock rule already does without any Activity being asked to judge it.

This record does not address admission — what an Activity requires to have been established before it may run at all. That is separate work, and the intent it will have to satisfy is stated here so the two are not conflated: an Activity handed an approved plan implements it rather than re-deciding it, and an Activity handed no plan and no authority to make one declines rather than improvising. Succession decides what an Activity SEES; it cannot decide what an Activity is allowed to DO with it.

This record also leaves the revise loop's standing assumption in place: the Activity that should answer a rejection is the one that produced the judged work, and `regress_to` is the only escape from that assumption today. A run whose reviewer rejects work for a reason the ORIGINAL author cannot fix has no path in the engine other than a regression to an earlier Activity.

## Context

Three observed defects motivated this record, found in three separate conversations, each looking local:

- A serial Stage folds its context once per UNIT, not once per Activity inside it. `run-activities.ts`'s `runUnit` closes over one fixed `ctx` for every Activity in a serial Unit (`runtime/domains/runs/src/use-cases/run-activities.ts:193`) and threads that same `ctx` through `unit.activities.reduce` without updating it between Activities (`runtime/domains/runs/src/use-cases/run-activities.ts:200`). The `discover` Lifecycle shipped at the time named one serial Stage with three Activities, `activities: [identify, conceptualize, plan]`, so `conceptualize` and `plan` both receive the Stage's OWN incoming context rather than the envelope the Activity immediately before them produced — `plan` never sees `identify`'s envelope at all.
- A consumer that follows a review reads the verdict where it expects the work. An agent Activity's `previous` field — what reaches the agent as `previous_envelope` — is `ctx.previous` unless the Activity declares `input: changes` (`runtime/domains/activities/src/use-cases/agent-activity.ts:141`-`143`). After a concurrent review Stage, `ctx.previous` is set to the FIRST declared reviewer's envelope (`runtime/domains/runs/src/use-cases/run-activities.ts:554`-`561`), a review verdict rather than the work it judged. The revise loop hands that same context straight to the builder it re-invokes (`runtime/domains/runs/src/use-cases/revise-loop.ts:454`-`456`), so the Activity whose contract is to revise its own prior work is handed a verdict as the thing to revise.
- A concurrent review Stage forwards one full envelope and discards the other. The same fold that picks the first reviewer's envelope for `ctx.previous` (`runtime/domains/runs/src/use-cases/run-activities.ts:554`-`561`) leaves the SECOND reviewer's full envelope reachable only through `ctx.upstream`, which exists precisely because `ctx.previous` cannot hold two answers — but a consumer that reads `previous` the way every default Activity does never looks at `upstream` at all, so the second reviewer's evidence is unreadable to the Activity that must act on it.

None of these are a decision anyone recorded. The serial fold happening at the Unit boundary rather than the Activity boundary is an accident of how the driver is written, not a choice anyone weighed against threading the context through every Activity in a Stage — which is why it surfaced as three apparently unrelated bugs rather than as a documented limitation anyone could point to.

**The per-consumer declaration of consumed envelope types** was rejected because the registry already computes whether an Activity judges — from its OUTPUT type, not a separate input declaration — and the revise loop already trusts that computation to decide what counts as a review. Adding a second, per-consumer declaration of what an Activity is willing to receive creates a place where the two declarations can disagree, and still says nothing about WHICH envelope, among a bounded history, a consumer meant.

**A filename convention**, under which a consumer looks for a document such as `plan.md`, was rejected because envelopes are not generally written to a named file; only the artifacts a human gate writes are. Adopting a convention would mean inventing a filename per Activity name that an agent must remember to write to, in place of one channel every Activity already receives through its context regardless of what produced it.

**Leaving the serial fold in place and repairing each consumer's prompt** was rejected because it reasserts the rule once per prompt instead of once in the engine. A new Activity inherits the correct behaviour only if its author remembers to restate the same instruction, and the three defects above are evidence that nobody reliably does — each was discovered independently, in a different prompt, long after the engine behaviour that caused it was written.

## Consequences

An Activity that wants the whole run's history, rather than only its single superseding input, has to ask for it in its own prompt; nothing changes for an Activity whose prompt does not. That keeps the change additive rather than a rewrite of every existing Activity's contract, at the cost of a history that is invisible to a prompt author who does not know to request it.

Bounding the history to the latest envelope per Activity Run means a revise loop that re-runs one Activity under several numbered instances contributes one entry to the history, not one per round — without that bound, a chain with a long-running revise loop would hand every later Activity an unbounded and ever-growing context.

Declaring supersession from an Activity's existing output type, rather than adding a second property for it, means an Activity that becomes a reviewer by changing its `output` to a review contract changes its succession behaviour for free, and an Activity that is not a reviewer cannot accidentally annotate instead of supersede by forgetting to set a flag nobody else has to set.

This record settles what an Activity sees. It deliberately leaves two things unsettled, so a later decision does not have to unpick this one to make them: what an Activity is allowed to do with what it is handed (admission), and who answers a rejection when the Activity that produced the judged work cannot fix the reason it was rejected (the revise loop's standing assumption, escaped today only by `regress_to`). Both are named here as the open edges of this decision rather than left to be rediscovered.
