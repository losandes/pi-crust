---
name: technical-research
description: Researches an external library, tool, framework, service, or development in the AI and agent tooling landscape, and reports whether to adopt it, adapt from it, or reject it. Use when asked to evaluate or compare a dependency, find out what is current in a fast-moving area, decide between competing packages, check whether something is maintained, or answer "should we use X". Also use before adding any dependency, and when a recommendation rests on a claim nobody has verified. Defaults for any project — use this only when the project itself advertises no equivalent convention skill of its own, which always wins.
---

# Technical Research

## Use this skill when

- Asked whether to adopt a library, tool, framework, or service
- Comparing candidates, or asked "what is everyone using for X"
- Catching up on a fast-moving area — model releases, agent tooling, a framework's direction
- Before adding any dependency
- A recommendation rests on a claim nobody has checked

## Do not use this skill for

- A question the codebase answers. Read it — `package.json`, the lockfile, and the code are faster and authoritative
- A question the installed package answers. Its README and types are on disk; searching the web for them is slower and often describes a different version
- Deciding where code belongs, or how to shape it — those are records, not research

## Write for inspection

Prose this skill produces follows [write-from-evidence.md](../adr/conventions/write-from-evidence.md): lead with the finding or decision, support it with evidence, distinguish observation from inference, make material uncertainty inspectable, and stop once the reader can evaluate and act on it. No checker enforces this.

## Step 1 — Establish the date

```bash
date
```

Everything downstream depends on it. Recency judgements made against a misremembered date are wrong in the direction that matters, because a stale project reads as current.

Model knowledge has a cutoff, and in this area the landscape moves faster than that. Treat anything recalled rather than fetched as a hypothesis.

## Step 2 — Use the tools that exist, and say which

Check before relying on one. Configured integrations vary by machine and several referenced in this repository's history were never configured at all.

| Tool | Good for |
|---|---|
| `gh search repos`, `gh api` | Repository metadata, file contents, releases, issues — no scraping needed |
| `npm view <pkg>` | Versions, publish dates, dependencies, deprecation |
| Web search or fetch, when the harness provides it | Announcements, docs, discussion |
| `curl` | A known URL, when nothing richer exists |

`gh api repos/<owner>/<repo>/contents/<path>` returns base64 file contents. Reading the source directly beats reading about it.

If a tool is unavailable, say so and describe what could not be checked. A gap named is a gap the reader can close; a gap hidden reads as a finding.

## Step 3 — Judge the project, not its popularity

Stars measure attention at some past moment. They do not measure maintenance, quality, or fit.

Check, in roughly this order:

- **Last push and last release.** A quiet repository in a fast-moving area is a liability; in a stable one it may be finished
- **Open issue count against recent closes.** Issues accumulating without replies is the clearest signal
- **Whether it is a fork, and of what.** In a crowded space, most candidates are forks of one upstream. Read the upstream; evaluate forks on what they changed
- **Whether "official" exists at all.** The most-starred is routinely not the canonical one, and sometimes there is no canonical one
- **Release cadence against the thing it integrates with.** A wrapper that has not moved since its host's last major version is broken or about to be

## Step 4 — Verify it can actually run here

The failure worth guarding against: adopting something whose prerequisites this environment does not satisfy. Two components in this repository's history called external services that were never configured, so every path through them failed — and nothing said so until they were run.

Before recommending adoption, confirm:

- Every external service it requires is configured, or say what would need to be
- Its peer dependencies match what is installed
- Its runtime and engine constraints match ours
- Its install actually completes. A `prepare` script invoking a dev-only tool fails for consumers while working fine in the author's clone

## Step 5 — Separate verified from claimed

Three categories, kept distinct in the report:

- **Verified** — you ran it, read the source, or fetched the metadata
- **Claimed** — the project says so and you did not check
- **Recalled** — you believe it from training, and it may predate the present

A benchmark in a README is a claim. A feature in a changelog is a claim. Label them, and the reader can decide what to trust.

## Step 6 — Recommend one of three

Never end with a survey. A list of options with no recommendation moves the work back to the person who asked.

| Verdict | Means |
|---|---|
| **Adopt** | Use it as a dependency. Name the version, the prerequisites, and what it costs |
| **Adapt** | Do not depend on it; take the ideas. Name which ones and why the rest were left |
| **Reject** | Name the disqualifying property, so the same candidate is not re-proposed |

Adapt is the most common answer for anything that is mostly conventions, prompts, or workflow. Those carry assumptions about a team, and a dependency imports the assumptions along with the value.

Say what would change the verdict. A rejection with a condition attached is re-checkable later; one without it has to be re-researched from scratch.

## Report

Lead with the recommendation, then the evidence. Order by decision relevance, not by the order you found things.

- What was checked, and what could not be
- The recommendation, with its reason
- What was rejected, and why — the rejected reasoning is what stops it returning
- Links, so a reader can disagree with the source rather than with you

Skip the survey of everything encountered. A finding that does not change a decision is not a finding.
