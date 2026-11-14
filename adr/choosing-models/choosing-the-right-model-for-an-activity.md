---
Context: All apps
---

# Choose a model by what an Activity cannot verify

## Status

proposed

## Decision

An Activity's model and thinking level are chosen from properties the Activity already declares, not from a model's rank on a benchmark. Score each Activity on five criteria, weight them, and read a capability tier off the total:

| Criterion              | Scored 1 when                                            | Scored 5 when                                                                    | Weight |
| ---------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------- | ------ |
| Underdetermination     | The output is a transform of its input                   | Many answers are defensible and choosing is the work                             | 2      |
| Unchecked blast radius | Nothing consumes the output, or every consumer checks it | Every later Activity reads it and none of them check it                          | 2      |
| Gate weakness          | A compiler and a test suite judge the output             | The gate confirms only that an artifact exists and is non-empty                  | 2      |
| Context load           | One short upstream handoff                               | Repository-wide exploration, several handoffs, and external sources at once      | 1      |
| Constraint fidelity    | Few constraints, mutually compatible                     | Many interfering prohibitions, a write allowlist, and a required output envelope | 1      |

Before any of that, a precondition: **establish that the model is on the cost-versus-score frontier at all.** Published per-effort curves show models that are beaten at every one of their own settings by a cheaper sibling from the same vendor. For such a model no effort level is the right answer, and asking which one to use skips the question that decides it.

Four rules then adjust the result, in order:

1. **Climb the effort range on an inexpensive model; stop short of the top on an expensive one.** Reasoning is billed as output tokens, so each step up costs more on a model that already costs more per token. Measured curves put the best value at the top setting for cheap models and one or two settings below it for expensive ones.
2. **Read the model's own curve rather than assuming that more is better.** Effort is not monotone: models score lower at their highest setting than one below it, and the top of a model's curve is frequently not its top setting.
3. **A strong gate may buy a cheaper rung** — but only where the retry it implies is short. An Activity whose retry re-runs its most expensive work does not qualify, because the retry costs more than the tier difference it saves.
4. **Frequency breaks ties downward.** An Activity that runs on every run, near a band floor, drops a band.

Two definitions carry most of the weight, and both were initially got wrong:

**Blast radius means *unchecked* propagation.** An Activity whose output is read by a reviewer, a test author, and an outcome check does not have a wide blast radius; it has three independent readers. Counting consumers rather than unchecked consumers scores the most-inspected artifact in the system as the most dangerous one, which inverts the entire result.

**Capability is bought where verification is absent, and it is priced in cost per task rather than price per token.** A model that costs less per token may spend several times as many tokens on the same work, which makes the cheaper-looking model routinely the more expensive one — see "Spend where verification is absent".

Tiers are capability classes, not model names. Binding a tier to a named model is configuration that is re-made whenever the catalogue changes; the tier itself is what this record fixes.

## Context

A roster declares a model and a thinking level per Activity, with a default for the ones that say nothing. The question is which Activities deserve to override the default, and a plausible-sounding answer — give the hardest-sounding work the highest-ranked model — turns out to be wrong in a way that costs money without buying quality.

### Spend where verification is absent

The cost of running an Activity is the price per token multiplied by the tokens the model spends, and the second term is not a property of the Activity. It belongs to the model and its effort setting, and it varies by an order of magnitude between models doing identical work. A cheaper-per-token model that spends several times the tokens costs more per task than the premium model it was chosen to avoid.

Capability is also worth least at implementation, because implementation is the only Activity whose output is judged by a compiler and a test suite rather than by whether a file exists. A plan is gated on being non-empty. Nothing mechanical reads it, nothing contradicts it, and a weak plan passes its gate every time — paid for later by the implementation that follows it, the review that argues with it, and the engineer who reads both.

So the money goes where verification is absent: upstream, where the documents are short, the gates are nominal, and every later Activity inherits the result. An implementation Activity can take a lower rung than its expense suggests, precisely because it is the most thoroughly checked. What it must not take is a model chosen for a low per-token price with no measured cost per task behind it.

### Reasoning budget at an implementation Activity is spent re-deciding the plan

There is a second argument for a low thinking level during implementation, and it is not about cost.

An implementation Activity is instructed to implement the plan it was given. A large reasoning budget has nothing to apply itself to except whether the plan is right — which is the failure mode usually described as the agent deviating from the plan. A low thinking level is not merely cheaper here; it is plausibly more faithful.

The limit on this argument is session length rather than judgement: a long tool loop over many files needs enough budget to keep the thread, and that is what a reasoning setting buys in a terminal benchmark. The risk of too little thinking at implementation is losing coherence across a long session, not misjudging a decision.

### What measurement corrected

Three of the rules above began as reasoning and were changed by per-effort benchmark data. The originals are recorded because each is a plausible argument a later reader will re-derive.

**"Buy the cheap model for the high-volume Activity."** This treated token volume as a property of the Activity and multiplied it by price per token. Measured, the cheaper model spent several times the tokens of the premium one on identical tasks and cost more per task as a result. Price per token is not a cost model.

**"Raise thinking before changing model, because reasoning budget is the cheaper purchase."** It is the cheaper purchase on an inexpensive model and is not on an expensive one, where a step up in effort can cost more than moving to a stronger model at a lower setting.

**"More thinking is weakly better."** Never stated outright, but assumed by a rule that only ever raised the setting. Published curves show models peaking below their top effort, so a configuration has to be checked against a curve rather than argued from first principles.

### What was rejected

**Pick the highest-priced model.** The most expensive models available were not the strongest at the work these Activities do. The top-priced tier at the time of writing was stronger at frontend and visual output and weaker at long terminal sessions and mergeable repository changes than a model at a fraction of the price. Price indexes specialisation at least as much as capability, so a tier ladder built on price buys the wrong axis.

**Rank models by a single benchmark.** The benchmarks that still separate frontier models measure terminal sessions, whether a maintainer would merge a change, professional knowledge work, and human preference on prose. Activities differ on which of those applies, and the same model can lead one and trail badly on another. A tier fixes the capability class; which model fills it for a given Activity is a separate question answered by the kind of work, not by an overall rank.

**Select a model by the paths a change touches.** Routing already selects skills and verification commands by changed path, so extending it to models looks natural. It is not expressible: a model is a property of the agent, and the agent is chosen before there is a diff to match against. An Activity that needs a different model for a different kind of work needs a separate entry in the roster.

**A two-axis stakes-by-difficulty matrix** was considered and rejected for collapsing the distinction the whole decision rests on: an Activity that is hard and unverified and one that is hard but mechanically gated land in the same cell, and they want opposite models.

### What is inference rather than measurement

No benchmark measures these Activities. Terminal-session and merge-readiness scores are the closest available proxies for implementation and review, and knowledge-work and hallucination-rate figures are the closest for research and planning, but the transfer from one to the other is an argument, not a result. A published figure also belongs to a particular reasoning setting; a model run below the setting its headline number was measured at is not the model that was measured.

## Consequences

Reading a tier off declared properties means the choice is auditable and re-derivable. Someone who disagrees can point at the criterion they would score differently, rather than at a preference. It also means the scores must be re-derived when an Activity's gates change, because a gate added or removed moves the criterion that matters most.

**The carve-out is an implementation Activity whose gate cannot cover its work.** Schema and data changes are the standing example: a test suite almost never exercises a migration against real data, so the gate that makes implementation safe to run cheaply is absent, and the mistake is the one class of implementation error that reverting does not undo. That Activity keeps a top-tier model even though every other implementation Activity does not. The rule is still "pay where verification is missing" — it is the gate that changed, not the exception.

**A specialist sits outside the ladder.** Where the work is judged aesthetically, no gate and no tier captures it, and the right model is the one that leads on that specific axis regardless of where it sits on the ladder. Keeping this out of the tier system rather than inventing a band for it is deliberate: a band implies the specialist is generally stronger, and it is not.

**An effort level cannot be shared across candidate models.** Because the best setting belongs to the model rather than to the Activity, a table offering alternative models for one Activity needs an effort column per candidate. A single shared column silently misconfigures every candidate but the one it was chosen for.

**Tier bindings go stale faster than the record.** Model catalogues change monthly, prices change on announced dates, and a promotional price turns a sound economic choice into an unsound one without any configuration changing. A binding carries an expiry the record does not, which is why tiers are named here and models are not.

**Splitting one Activity into per-stack variants multiplies the lifecycle surface.** Separate entries are the only way to vary the model by kind of work, and every Lifecycle then names a specific variant. Before splitting, weigh that against keeping one entry at the tier the hardest variant needs and accepting the overspend on the easy ones.

**Where this is wrong, it fails quietly.** A model too weak for an Activity with a strong gate fails loudly and retries. A model too weak for an Activity gated only on artifacts existing produces a plausible document that passes, and the cost appears later as rework nobody attributes to it. That asymmetry is the reason gate weakness carries a heavy weight, and it is also the reason an under-spend is harder to detect than an over-spend.

**Independence between a reviewing Activity and the Activity it reviews is untested.** A reviewer drawn from a different model family shares fewer blind spots with the implementation it judges, which argues for deliberately mixing families across a chain. Nothing has measured it, and it trades against the reviewer's own ability to read a diff, so it is recorded as an open question rather than a rule.

This record moves from proposed to accepted when a roster has been configured from it and run — the tier assignments are derived but unexercised, and a derivation nobody has run is a hypothesis with a table.
