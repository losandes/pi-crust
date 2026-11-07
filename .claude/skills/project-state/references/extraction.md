# Extracting state from evidence

## Sources are evidence, not state

A Slack discussion is not project state. A PR description is not project state. A Pi session is not project state. A set of personal notes is not project state. Another developer's artifact is synthesised evidence, but it is still their representation of what they knew.

Sources may include: exported Pi JSONL sessions, Markdown notes, text files, design or architecture documents, pasted Slack conversations, GitHub issues, PRs and PR discussions, commit information, investigation notes, meeting notes, pasted text, another developer's project-state artifact, or anything else the developer supplies — as paths, as tool-reachable references, or as content already in the conversation.

Each may contain evidence of decisions, discoveries, current work, unresolved questions, constraints, or failures. Extract that and normalise it. **Never organise the artifact by source type.** Three sources contribute to `## Decisions`, `## Active Work`, and `## Known Problems` — not to `## Slack Notes`, `## PR Notes`, and `## Pi Session Notes`.

## What the artifact must answer

- What are we trying to accomplish?
- What work is currently active?
- What has recently been completed?
- What important decisions have been made, and why?
- What constraints or conventions affect future work?
- What did we discover while implementing or investigating?
- What problems or risks remain?
- What questions are unresolved?
- What should happen next?
- Which branches, PRs, issues, packages, files, or documents are particularly relevant, and why do they matter?

Do not attempt to preserve everything in the sources.

## Principles

### Prefer current state over chronology

Reconstruct the most current state the evidence supports. If earlier evidence proposes X and later evidence rejects X for Y, record Y as the decision. Keep X only where knowing why it failed would materially help future work. Do not write a diary.

### Reconcile rather than append

When updating, integrate new information into the sections that already exist. Update stale statements. Delete or rewrite what is no longer true. Move finished items out of Active Work. Close open questions and known problems whose resolution has arrived. Do not create a second entry because the same subject appeared in a second source.

### Preserve rationale

A decision without its reason loses most of its value.

> **Decision:** Keep authorization at the resource-instance level. **Rationale:** Organization-level roles cannot represent permissions that differ between resources.

Preserve the reason concisely. Do not preserve the deliberation that produced it.

### Distinguish fact from uncertainty

Do not promote speculation to project fact. Mark unresolved conclusions explicitly:

- **Known:** …
- **Suspected:** …
- **Open question:** …
- **Needs verification:** …

Where sources disagree and the current position cannot be settled confidently, record the disagreement as unresolved rather than picking a side.

### Account for source authority and freshness

When evidence conflicts, weigh whether one source is newer, whether one reports an implemented result rather than a proposal, whether one records an explicit decision, whether one is primary evidence rather than someone's interpretation, and whether the existing artifact holds durable knowledge the new evidence does not contradict.

Newest is not automatically correct. When an important conflict cannot be resolved, record the uncertainty.

### Preserve useful negative knowledge

Record failed approaches, surprising behaviour, and rejected designs where doing so stops someone repeating expensive work.

> **Rejected:** Caching resolved permissions across organizations. **Reason:** Permission results depend on the resource instance and may differ across organizations.

Not every abandoned idea qualifies.

### Keep it small, and make it smaller

The artifact exists to reduce future context cost, and it is durable working context rather than an activity log. [retention.md](retention.md) carries the keep/omit lists, the six-month retention test, and the distillation rules; apply it to every candidate line before writing, and again to what is already there when updating.

The short version: omit chronology, diff stats, commit hashes, test counts, branch names that nothing needs to resume, review threads, completed activity, transient status, and anything already authoritative in Git or GitHub.

## Processing multiple sources

1. Read all the relevant supplied evidence.
2. Establish chronology only where it helps determine current state.
3. Identify references to the same decisions, problems, work items, PRs, issues, components, and implementation areas across sources.
4. Merge them into unified state.
5. Give newer evidence precedence where it clearly supersedes older evidence.
6. Weight implemented or explicitly decided outcomes over exploratory discussion.
7. Preserve unresolved contradictions explicitly.
8. Write normalised state, not per-source summaries.

## Updating an existing artifact

For each meaningful new piece of information, decide whether it adds new state, confirms existing state, updates it, supersedes it, resolves an open question, completes an active item, invalidates an earlier conclusion, or contradicts what is there. Then edit accordingly.

An update is also a chance to shrink. Re-apply the retention test to what is already in the file: superseded state is rewritten rather than appended beside, finished work is reduced to the knowledge it left behind, answered questions become the answer, and fixed problems survive only as the constraint or trap they created. If the artifact grew but did not get denser, the pass was not finished.

Do not delete durable architectural decisions, discoveries, constraints, or negative knowledge merely because the newly supplied sources did not mention them.

## References

Preserve the identifiers that make later retrieval or verification cheap: PR numbers, issue numbers, package and module names, important file paths, design documents, and stable external links. Keep a branch name or a commit hash only when it is needed to resume — unmerged work waiting on a branch qualifies; the commit that introduced a merged change does not, because Git can answer that.

These are pointers, not substitutes for knowledge, and not a place to restate what GitHub already holds — no diff stats, no file counts, no review threads.

> **PR #184 — Authorization middleware:** Implements resource-instance permission evaluation. Awaiting review.

is worth keeping. `See PR #184.` is not. A future session should understand why a reference matters before deciding whether paying the context cost of fetching it is worthwhile.

## Accuracy

Record only conclusions supported by the supplied sources or the existing artifact. Do not invent missing state. Do not infer that an issue is closed, a PR merged, an implementation deployed, or a decision final unless the evidence establishes it.

Unless explicitly asked to retrieve live state, treat GitHub, Slack, Git, and other external systems named in the evidence as possibly changed since the evidence was captured. The artifact is synthesised knowledge, not a live view.
