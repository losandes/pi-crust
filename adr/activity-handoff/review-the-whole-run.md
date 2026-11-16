---
Context: All apps
---

# Review the whole run

## Status

accepted

## Decision

A judging Activity is identified by its declared review output, never by its name. Give every judge the run's net repository change on every execution, including re-reviews. A writer's report does not select that scope. The same file list selects primed skills and the recorded changed-path count.

Record the run's start commit and content digests under its first request Activity Run. Keep the first valid start state: a later invocation joining the run must not replace it, and resume and branching retain it through the trace. Compare current content against that original commit and compare the resulting digests with the recorded digests using the existing path comparison. Include additions, deletions and changed values, whether committed or uncommitted. Exclude the session and handoff directories on whole path segments and sort the remaining paths.

A named scope overrides the run's change entirely. Without one, if there is no valid start state or no product difference remains, keep the working-tree fallback. An Activity with captured change input retains its captured paths in that fallback and when a scope is named. Otherwise, give the judge the run's paths and tell it to read their differences against the start commit, including committed work. If that commit can no longer be read, stop the judging Activity with an error naming the commit and `--scope`; do not silently narrow its scope to uncommitted work.

This changes what a judge is told to judge, not the envelope it receives. [Envelope succession](envelope-succession.md) continues to govern that input.

## Context

[Issue #135](https://github.com/losandes/pi-crust/issues/135) records evidence from the trace database local to the identifying agent's machine, not deployed or universally available state. In run `fb22a6e9`, build reported production work, test reported only test work, and both reviewers were given only the latter; a revise round narrowed their scope again. In run `8702519b`, build committed its work, test reported nothing, and code-review approved with an empty scope. In run `d182d4ec`, a failed revise attempt changed a file, its successor reported nothing, and both re-asked reviewers approved with no files. These are the issue's reported observations, not database queries repeated while implementing this decision.

The union of envelope claims was rejected because a claim can omit work, a replacement report can lose earlier changes, and a claim can include the run's own working records. The union of observed touched paths plus a start commit was rejected because observations are recorded only after output parses, the existing fingerprint cannot detect all content edits, and only agent Activities are observed. A temporary-index tree object at the start and at each review would preserve exact pre-run content and support exact tree differences, but writes objects into the developer's repository and requires new index plumbing. Reconsider that option if reviewers must distinguish pre-run uncommitted content from subsequent changes to the same file.

Content digests select actual differences without requiring a complete envelope history or attributing each write to an Activity. The request Activity Run owns the event so trace replay and branch seeding retain the same origin.

## Consequences

Every difference from the start state is attributed to the run, including concurrent developer edits. A run that restores everything it changed falls back to reviewing the working tree.

Pre-run uncommitted content is recorded only as a digest. A diff against the start commit includes earlier uncommitted edits to a listed file, and cannot show pre-run uncommitted content the run removed. Exact separation of those edits is not provided.

A run begun before this behavior shipped has no start state and falls back to the working tree on resume. An explicit scope can select its committed work instead.

Every review and re-review receives the whole run's list. Each snapshot reads every uncommitted and every changed file once; the list is not capped. Ignored files are not listed: repository files are those git tracks or would track.
