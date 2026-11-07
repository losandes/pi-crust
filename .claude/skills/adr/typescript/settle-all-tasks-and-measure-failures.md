---
Context: All apps
---

# Settle all tasks and measure failures

## Status

accepted

## Decision

When processing a collection of independent tasks, use `Promise.allSettled`, process every item, and report the failure margin. Do not use `Promise.all`.

| Situation | Rule |
|---|---|
| Independent per-item work over a collection | `Promise.allSettled`. Process all items, count failures, log the margin. **This is the default.** |
| Multiple writes that must all land or none | A database **transaction**. Neither `all` nor `allSettled` provides atomicity. |
| Fixed tuple where any failure fails the whole operation | `Promise.all` is permitted. **Expect this to be rare** — see below. |

`Promise.all` rejects on the first rejection and discards every result that had already succeeded. For a batch of independent items that is the worst available outcome: work is done, paid for, and thrown away, and the partial state is invisible to the caller.

### The default, in full

```ts
import { isFulfilled, isRejected } from '@workspace/typedefs'

const settled = await Promise.allSettled(items.map(processOne))

return {
  successes: settled.filter(isFulfilled).map((s) => s.value),
  failures: settled.filter(isRejected).map((s) => s.reason),
}
```

`PromiseSettledResult` is a union, so narrowing it needs a type guard on the `status` discriminant. Import the guards; do not redeclare them per call site.

Every settlement is accounted for. The caller receives both sets and decides what the failure rate means.

### Return a settlement, don't invent a result shape

The batch settlement type described under "Return results; don't throw for expected outcomes" in [functional-conventions.md](./functional-conventions.md) already expresses "succeeded, with a measured margin of failure." Use it rather than hand-rolling `{ successes, failures }` per call site.

```ts
Readonly<{
  status: 'ok'
  data: TData[]
  hasIssues: boolean // true if any item failed
  issues: unknown[]  // the reasons those items failed
}>
```

That is this ADR's contract expressed as a type: a batch can succeed *and* report what failed. The policy it encodes — partition valid from invalid, return `ok` with populated `issues` when some items fail, return `error` only when nothing succeeded — belongs in a shared builder, not repeated at each call site.

Aggregate rejection reasons into a composite error rather than concatenating messages into a string.

### Reporting the margin

A settlement records the margin; it does not announce it. A batch that partially failed is not a success — log it, with counts, at a level that matches the damage:

| Condition | Level |
|---|---|
| All items succeeded | `info` (or `trace` for routine high-frequency batches) |
| Some items failed, result still usable | `warn`, with `{ attempted, succeeded, failed }` |
| Failure rate makes the result untrustworthy, or all items failed | `error` |

Use a named snake_case event, consistent with the rest of our logging:

```ts
settlement.status === 'ok' &&
  settlement.hasIssues &&
  logger.warn(
    {
      attempted: items.length,
      succeeded: settlement.data.length,
      failed: settlement.issues.length,
      issues: settlement.issues,
    },
    'process_batch_partial_failure',
  )
```

`hasIssues` is the signal to check. Because `allSettled` never rejects and a settlement with issues still reports `status: 'ok'`, a call site that inspects only `status` will report a half-failed batch as a clean success.

Never discard the rejection reasons. A count without causes cannot be acted on.

### On the third row

The carve-out covers a fixed, heterogeneous tuple whose parts are all required — for example, fetching two unrelated resources to assemble one response, where the absence of either means the operation cannot complete. We expect **very few** occurrences. Before using it, confirm all three:

1. The arity is fixed and known at authoring time, not `items.map(...)`
2. Partial success genuinely produces nothing usable
3. The parts do not need to be **mutually consistent**

Point 3 disqualifies more cases than it appears to. A paginated read that fetches a total count and a page of rows as two concurrent queries has no shared snapshot: under concurrent writes the count describes a different moment than the rows. `Promise.all` is not the bug there, but it conceals it. Use a single query with `COUNT(*) OVER()`, or a repeatable-read transaction.

If the tuple is required *and* must be consistent, it is a transaction, not a `Promise.all`.

## Context

- **What problem**: `Promise.all` silently converts a partial failure into a total failure, destroying completed work. Batch jobs over rate-limited third-party APIs are the common case: one 429 discards an entire batch of successful calls, and a retry re-does the work that already succeeded.
- **How we know**: the expectation existed as a verbal agreement. Audited across packages, one codebase followed it universally and another violated it universally — the split fell along authorship, not along any technical distinction. An unwritten convention is not reviewable, so it was not reviewed. This ADR exists to make the expectation citable in a pull request.
- **Constraint**: `allSettled` never rejects, so failures are invisible unless the code inspects them. Requiring the margin to be logged is what stops this ADR from replacing loud failures with silent ones.
- **Alternative considered**: ban `Promise.all` outright. Rejected because authors would write `allSettled` followed by "throw if any rejected", which is `Promise.all` with more steps and less clarity. A narrow, justified carve-out is more honest than a rule people route around.

## Consequences

**Easier**

- Batch jobs complete. A single bad item costs one item, not the batch.
- Failure rates become observable, so degradation is visible before it is total.
- Retries are cheap: only the failed items need reprocessing.

**Harder**

- More code per call site. Successes and failures must both be handled, and the compiler does not force it — `allSettled` resolving is not a success signal.
- Authors must choose a log level and event name, which is a judgment call.

**Risk of getting it wrong**

The failure mode of this ADR is a batch that quietly discards items while reporting success. Any `allSettled` whose rejected results are not inspected is a defect, and should be treated as one in review.

**Migration**

New code follows this ADR. Existing code migrates when touched for another reason; this is not a mandate for a bulk-rewrite pull request.

Audit bounded-concurrency helpers first. A utility written to make rate-limited batch work safe, but which awaits its workers with `Promise.all`, propagates a single rejection and discards every completed result — the exact failure this ADR prevents, inherited by every call site at once.

Each project records its own compliance state and known deviations in its `CLAUDE.md`.
