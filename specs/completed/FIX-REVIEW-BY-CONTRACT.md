# Fix: a review is a declared contract, not a name

## Objective

The bounded revise loop applies to any Activity that declares `output: reviewOutput`, whatever a team named it, and to no Activity that does not. Acceptance sets aside exactly the verdicts the loop re-asks, so a run is never reported accepted while a reviewer that was never re-asked is still rejecting. No module decides what a review is by comparing a name against a list in TypeScript.

This changes how the loop recognises a review and which verdicts acceptance sets aside. It does not change what the loop does once it runs, what a reviser is, or how a round is counted.

## 1. Requirements

### 1.1 The loop triggers on the declared contract

1.1.1 `REVIEW_STEPS` in `runtime/modules/use-cases/revise-loop.ts` MUST be deleted. It is the only place in the engine that decides whether an Activity is a review by its name; `envelopeAccepted`, `envelopeJudges` and `reviserFor` all decide from the registry already.

1.1.2 An Activity MUST be treated as a review when, and only when, the registry entry it was resolved from declares `output: reviewOutput`. The judgement MUST come from `crust.activities.yaml` through the loaded config, never from a name.

1.1.3 `trailingReview` MUST take the loaded configuration and answer from it. Its callers — `loopApplies`, `loopAgents` and `runReviseLoop` — MUST pass it through.

1.1.4 `reviewFrom` MUST ask the same question of the registry rather than of a name list. It MUST NOT infer a verdict from the payload: `reviewOutputSchema` parses a build envelope and fills `approved: false` from its default, so shape-sniffing would read "not approved" off work nobody judged.

1.1.5 A chain whose last Activity declares any other `output` MUST NOT get the loop, exactly as today. `runReviseLoop` MUST settle `not-applicable` for it.

1.1.6 No name-based fallback MUST remain for `review`, `outcome-review` or `code-review`. A roster that still names an Activity `review` keeps the loop because its entry declares `output: reviewOutput`, which is a stronger guarantee than the list it replaces.

1.1.7 The error in `reviewOf` and the prose that states the rule MUST describe the contract rather than two names. The places that state it are `revise-loop.ts`, `run-workflow.ts`, `parse-activities.ts`, `lifecycles/compose.ts`, `runtime/README.md`, [SKILL.md](../SKILL.md), [cookbooks/crust_overview.md](../cookbooks/crust_overview.md) and [cookbooks/run_lifecycle.md](../cookbooks/run_lifecycle.md). A sentence naming two Activities MUST NOT survive anywhere in the tree.

### 1.2 Acceptance sets aside exactly what is re-asked

1.2.1 The set of Activities excluded from `acceptedExcluding` MUST be the set the loop re-runs, and nothing else. A verdict that is never re-asked MUST stay decisive.

1.2.2 The loop MUST re-ask every judging Activity in the trailing group, where the trailing group is the longest suffix of the executed chain whose every entry declares `output: reviewOutput`. The shipped `accept` Stage is `[outcome-review, code-review]`, so both are re-asked; a chain ending in one reviewer re-asks one.

1.2.3 A round MUST be settled as approved only when every re-asked review approved. One rejection in the group MUST open another round, bounded unchanged by the reviser's `attempts`.

1.2.4 The findings carried into a revise round MUST be the union of the blocking items of every re-asked review, so the builder answers all of them in one round rather than discovering the second reviewer's findings after the first is satisfied.

1.2.5 One ledger record per round MUST continue to be written, folding every re-asked review's `blocking` and evidence into that single record. `unmovedFindings` MUST keep operating on consecutive records unchanged.

1.2.6 The loop MAY re-run the group's Activities serially. They declare disjoint `writes`, so ordering changes nothing a reader can observe except the trace.

### 1.3 The defects this closes are proven by tests

1.3.1 A test MUST show that a chain ending in an Activity named something other than `review`, `outcome-review` or `code-review`, declaring `output: reviewOutput`, gets the loop.

1.3.2 A test MUST show that a chain ending in a non-judging Activity does not get the loop.

1.3.3 A test MUST show that a rejecting review which the loop does not re-ask leaves the run not accepted. This is the false green that exists today: `acceptedExcluding(outcomes, REVIEW_STEPS)` discards a rejection by name whether or not the loop ever re-ran it.

1.3.4 A test MUST show that both members of a trailing group of two reviewers are re-asked in a round, and that one rejection keeps the loop going.

## 2. Target state

The discriminator, stated once. Where this and the prose in section 1 disagree, section 1 governs.

```ts
/**
 * Does this Activity rule on a change somebody else made?
 *
 * Resolved through `envelopeNamed`, because an entry names the CATALOGUE KEY
 * (`reviewOutput`) while the spec's own `name` is `ReviewOutput`. Comparing
 * the two strings is always false — which is how `reviserFor` has been
 * silently falling through to its `build` fallback since it was written.
 */
const judges = (cfg: TPiCrustConfig, name: string): boolean => {
  const activity = cfg.activities.find((one) => one.name === name)

  return (
    activity !== undefined && envelopeNamed(activity.output) === reviewOutput
  )
}

/**
 * The reviews a chain ends in: the longest suffix of judging Activities.
 *
 * Empty when the chain does not end in one, which is what settles
 * `not-applicable`.
 */
export const trailingReviews = (
  names: readonly string[],
  cfg: TPiCrustConfig,
): readonly string[] => {
  const from = names.findLastIndex((name) => !judges(cfg, name)) + 1

  return names.slice(from)
}
```

Acceptance excludes that same set and no other:

```ts
accepted: acceptedExcluding(ctx.outcomes, trailingReviews(names, cfg))
```

## 3. Out of scope

- **The envelope contracts.** `reviewOutput`, `buildOutput` and `envelopeAccepted` are unchanged. This spec changes who asks the question, not what the answer means.
- **`reviserFor`.** It already resolves the writer from the registry by `output: buildOutput`. Do not rewrite it, and do not give the loop a second way to choose a reviser.
- **The attempt budget.** `attempts`, `REVISE` and the ledger's round numbering stay exactly as they are. A group of two reviewers is still one round and still spends one attempt.
- **The dispute rules.** `disputes_supported`, the deadlock test and `disputes.md` keep their current semantics; 1.2.5 changes what one record is folded from, not how two records are compared.
- **The shipped roster and Lifecycles.** `crust.activities.yaml` and `crust.lifecycles.yaml` are not edited by this work. The rename of `review` to `outcome-review` already landed; this spec must not revisit it.
- **Concurrency inside the loop.** Re-asking the group serially is permitted by 1.2.6; building a concurrent Stage inside the loop is not part of this work.

## 4. Work stages

| #   | Change                                                                                        | Proven by                                                                 |
| --- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1   | 1.1.1–1.1.6, 2 — `trailingReviews` from the registry; delete `REVIEW_STEPS`; thread `cfg` through `loopApplies`, `loopAgents`, `reviewFrom`, `runReviseLoop` | `cd runtime && bun test && bun x tsc --noEmit`; `grep -r REVIEW_STEPS runtime` returns nothing |
| 2   | 1.2.1–1.2.6 — re-ask the whole trailing group, fold its findings into one round, exclude exactly that set | `cd runtime && bun test`                                                   |
| 3   | 1.3.1–1.3.4 — the four tests, written against `revise-loop.test.ts`                            | `cd runtime && bun test modules/use-cases/revise-loop.test.ts`             |
| 4   | 1.1.7 — the prose that states the rule                                                         | ``grep -rn "review. or .code-review" runtime SKILL.md cookbooks apps`` exits 1 |
| 5   | Whole-repository verification before the work is reported done                                 | `cd runtime && bun test && bun x tsc --noEmit`; `(cd apps/visualizer && bun test && bun x tsc --noEmit && bun x vite build)` |

Stage 1 lands before stage 2 because deleting the name list is what forces the exclusion question to be answered; doing them in the other order means writing the exclusion twice.

## 5. Rationale

**The list was the last hardcoded registry.** [FIX-INCOMPLETE-OPEN-CLOSED.md](completed/FIX-INCOMPLETE-OPEN-CLOSED.md) 1.1.4 deleted `STEP_NAMES` and `STEP_REGISTRY` so that a team could add an Activity by editing configuration. Its own 1.3.1 records the exception in passing — "the revise loop keys on `review` and `code-review` alone" — stated as a fact about `verifyOutput`, not as work left undone. That sentence is the defect this spec closes.

**What it costs today.** An Activity declaring `output: reviewOutput` under any other name ends a chain with no loop: its rejection is honoured, because `envelopeAccepted` reads the contract, but the findings never reach the builder, no round is run, no attempt is spent, and no `disputes.md` is written. Nothing warns, because a chain not ending in a review is a legitimate chain.

**And in the shipped configuration.** `acceptedExcluding(outcomes, REVIEW_STEPS)` sets aside every verdict from an Activity *named* `outcome-review`, `review` or `code-review`, whether or not the loop re-asked it. The shipped `accept` Stage holds two reviewers and the loop re-runs only the trailing one, so a rejection by the other is discarded from acceptance and never re-asked. That is a run reported accepted over a live rejection, which is worse than the missing loop and is the reason 1.2 is in this spec rather than in a later one.

**Why the registry rather than the payload.** Sniffing the envelope was rejected: `reviewOutputSchema` accepts a build envelope and defaults `approved` to `false`, so a payload test reads "not approved" off work that was never judged — the reason the original name check existed. The registry's `output` is a declaration a team wrote, checked at load against the published envelope catalogue, which is the same evidence `envelopeAccepted` already trusts to decide whether a rejection counts.

**Why a suffix rather than "every review in the chain".** A chain may review, build again, and review again; the earlier verdict belongs to work that has since changed and is not the question the loop re-asks. Taking the trailing group keeps the rule computable from the executed names alone, with no Stage structure threaded into the loop, and matches what the shipped Lifecycles mean by `accept`.

**Rejected: keeping a name list with the new name added.** That is what the `outcome-review` rename did as a stopgap, and it reproduces the defect for the next team that names a reviewer anything else. A list that must be edited in TypeScript when configuration changes is the thing [FIX-INCOMPLETE-OPEN-CLOSED.md](completed/FIX-INCOMPLETE-OPEN-CLOSED.md) set out to remove.
