---
Context: All apps
---

# Import referenced work before running Activities

## Status

accepted

## Decision

A Lifecycle opts into importing earlier work by naming the engine step `import` first in its first, serial Stage. The engine removes it before resolving the Activity fold and runs it after recording the request, before any agent starts. Configuration cannot define an Activity or alias with that name. The shipped delivering Lifecycle `ship-to-plan` opts in; Lifecycles that identify, diagnose or plan for themselves do not. Existing installations adopt the change by hand rather than through an update that replaces their configuration.

Every recognised GitHub issue reference or markdown path in the request counts as naming the work. Duplicate references to the same source are collapsed; distinct sources stop the run rather than being chosen between. The prompt resolver carries the original file argument forward as `promptPath`, so a markdown prompt file is imported without scanning its contents for further references. Relative inline paths resolve against the repository root; the original prompt path resolves against the invoking working directory.

Import reads issues only from the run's repository, through the operator's authenticated `gh api` boundary. REST comment objects provide last-edited times that `gh issue view` does not. Documents are read from disk, uncommitted edits included, with their digest and git provenance. Protected documents stop the run rather than copying protected content into universally readable handoffs. Explicitly referenced ignored documents are supported.

Only fence-aware `Handoff` dividers attribute sections to Activities. Labels resolve by registered name, alias or handoff-document basename; headings and source filenames do not imply attribution. Filing writes an end marker, keeping the filer's attribution and provenance outside the final document. Internal text and line endings are preserved. An unmarked description becomes `imported-work.md`; unattributed material is retained and labelled rather than silently discarded.

The latest posted version of each attributed document is used, with earlier versions retained as unattributed material and every version recorded. Existing files are never overwritten. Sections for Activities the chain will execute, annotating Activities and Activities without a document stay unattributed. Earlier work already in the handoff directory is listed even when the request references nothing. An empty handoff directory with no reference succeeds without producing an envelope.

Every issue comment is recorded. Only comments whose authors have `OWNER`, `MEMBER` or `COLLABORATOR` association can yield work documents or be appended to them. Other comments remain labelled unattributed context. An unmarked trusted comment targets the first earlier imported document matching a question code it cites, or the latest earlier imported document otherwise. Its divider states that answers supersede provisional answers to those codes. Comments without a target stay unattributed.

The import emits an `ImportOutput` envelope listing documents, versions, comments, placement and source provenance. It becomes the initial superseding input and the first upstream history entry; no synthetic plan or identify envelope is invented. The Activity Run is `kind: code` with owner `pi-crust`, while its envelope row's agent is `import`. Agent-history replay skips code rows; import replays its own saved envelope history without any source-port calls. A missing history file means no envelope; an invalid existing history file is an error, never a fallback to unrelated per-agent state. The operator report renders this provenance without requiring an agent transcript.

All files are planned before writing. At the first failed write, stop writing, remove previously created paths in reverse order, and remove the failed path if it now exists. Attempt remaining removals even after a removal failure. The stop message reports the failed write, the number removed and every path that could not be removed. Earlier files are never candidates for cleanup.

## Context

A delivering run previously started its first working Activity with no upstream envelope even when its request named an issue containing the already agreed work. The import supplies the work through the envelope channel selected by [Envelope succession](envelope-succession.md), without requiring every consuming prompt to rediscover the source.

A registry Activity would require agent configuration for deterministic work that has no agent. A Lifecycle flag would not be expressible in `--activities`. An engine-wired name follows the terminal Activity's placement and removal pattern while permitting the operator to enable importing with a local configuration edit.

Synthesising separate Activity envelopes was rejected because markdown cannot establish the facts, decisions and assumptions those contracts require. Repairing each consumer's prompt was rejected because new consumers would have to remember the same rule. Only the filing prompt changes; import notes and comment dividers carry the consumption instructions.

Choosing the intended reference using language heuristics was rejected because ambiguity would be silent. Divider-only attribution avoids guessing from headings or filenames; fence awareness prevents quoted examples from splitting real documents. The closing marker prevents filer-authored text from becoming part of the last document.

Temporary-name writes and renames were rejected because they still require cleanup and introduce extra names into the directory Activity Runs snapshot. Leaving partial writes was rejected because the next import would treat an incomplete file as existing work and never finish it. Undo can remove only paths created by this invocation because planning never schedules existing paths.

A separate `--import` flag was rejected because the request already names the source. Enabling import by default for `ship-to-outcome` was also rejected: it starts by producing its own plan, although the chain-Activity exclusion makes opting in by hand safe.

## Consequences

Ambiguous references, unreadable or protected sources, cross-repository issues, pull requests and sources with no usable work stop the run before an agent starts. This is intentionally stricter than interpreting a reference as incidental; operators can reword the request or select a chain without import.

The handoff files and saved envelope pin what a resumed run implements even if the source changes later. No later reconciliation or automatic refetch occurs. A failed cleanup is the exception to all-or-nothing writes: the operator must remove the paths named in the stop message before retrying. GitHub associations restrict which comments become instructions but do not establish that trusted content is correct.

Automated tests can establish parsing, byte preservation, provenance, stop conditions, rollback and replay. They do not establish that an agent follows the filing marker instruction or judges imported criteria and comment answers correctly. Those assumptions require a live filing run followed by a delivering run; a missing marker or a review ignoring an imported criterion is evidence to reconsider the prompt contract.
