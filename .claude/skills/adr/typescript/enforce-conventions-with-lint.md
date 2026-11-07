---
Context: All apps
---

# Enforce conventions with lint

## Status

accepted

## Decision

Where a convention can be checked mechanically, enforce it in the linter rather than relying on review to catch it. Where it cannot, say so in the same breath, so a green build is never mistaken for conformance.

A written convention is a better verbal agreement, not a different kind of thing. Both depend on a reader knowing the rule exists, recalling it at the moment it applies, and preferring it to the pattern in the file being edited. A lint rule fails the build.

## Three tiers, in this order

Reach for the cheapest mechanism that can answer the question.

| Tier | Mechanism | Use when |
|---|---|---|
| 1 | A built-in linter rule | The linter already has it. Check before writing anything |
| 2 | A custom AST rule (linter plugin) | The pattern is syntactic and local to one file |
| 3 | A script invoked by a skill | The question needs resolved types, cross-file context, or the filesystem |

Most conventions land in tier 1 or 2. Tier 3 is for questions a syntax matcher cannot answer at all — whether a parameter type is *already* immutable requires resolving the type and following its aliases, which no AST pattern can do.

Skipping tier 1 is the common mistake. A rule that reports nothing may be switched off rather than satisfied, so confirm with a deliberate violation before concluding the codebase is clean.

## Scope carries the meaning

A rule that fires mostly on correct code will be suppressed, and suppression is a habit rather than an event. When a rule produces mostly noise, the usual cause is that it asks its question in the wrong *place*, not that the convention is wrong.

A mutation ban applied everywhere reports overwhelmingly on interop: the framework channel that is the only way to pass request state, the DOM property that is the API, the component field the view library requires. The same ban applied to the pure core reports a handful, and each is the convention being broken.

Narrow a rule to where the convention applies before weakening it.

This does not license the opposite move. **Scope chosen from the convention is design; scope chosen from the failure list is evasion.** Deciding a rule does not apply to a directory *because it fails there* produces a green build that distinguishes nothing.

## No package is exempt

A rule applies everywhere or it is not a rule. Packages with pre-existing violations fail, and the failure is the record of the debt.

Exempting a package hides the rule from exactly the people who need it. Inside the excluded path the editor stays quiet and the rule is indistinguishable from one that does not exist, so the debt stops being felt by whoever is positioned to repay it. A failing lint run is a worse experience and a better signal.

Pre-existing violations are not repaid in bulk. They are repaid when the surrounding code is touched for another reason, and recorded meanwhile in the package's own documentation so a reader knows the failure is expected.

## Escapes

A rule with no escape hatch gets disabled wholesale the first time it is wrong. Every banned pattern takes a suppression comment carrying a reason, and the reason must name the exception the record allows — not that the rule is inconvenient.

Two properties decide whether this works, and both should be verified in the chosen tool rather than assumed:

- **A reason must be mandatory.** If a bare suppression is accepted, suppression becomes the cheapest way to a green build. Prefer a linter that rejects an unexplained suppression outright.
- **Suppression granularity is usually coarser than expected.** If one comment silences a whole category rather than a single rule, then as rules accumulate a suppression written for one will quietly cover another. Keep suppressed lines short and single-purpose, and review them as code.

A suppression without a reason is a defect. A suppression with a reason is a decision, and decisions are greppable.

## What review still owns

Mechanical enforcement covers a minority of our conventions. Naming that minority honestly is part of the decision, because the alternative is a team that reads a passing build as approval.

Review still owns whether a local mutation clears the bar the record sets, whether a use case is pure or quietly fetches what it should have been given, whether untrusted data was parsed or cast, whether a reported failure margin is inspected or dropped, whether a module is named for its domain or its layer, and whether a composed pipeline has gone abstract enough to obscure its intent.

None of these can be expressed as a pattern. A rule that cannot be enforced should not pretend it can be.

## Context

- **How we know**: an audit of one convention found it followed universally in one codebase and violated universally in another, split along authorship rather than any technical distinction. Nothing had failed, because nothing could.
- **Why the tiers are ordered by cost**: a custom rule is a small program with its own failure modes. One that silently matches nothing reports zero violations forever and reads as a clean codebase, so every custom rule is verified to fire on a violation *and* stay silent on the compliant form before it is enabled.
- **Blast radius is measured with the linter**, not with a text search. A shell glob and a linter's path glob do not mean the same thing, and the difference reads as zero rather than as an error.
- **Constraint**: a linter is not a gate until something runs it on the way in. Until then these rules are a signal in the author's terminal and editor, which is where they are cheapest to act on and easiest to ignore.

## Consequences

**Easier**

- The conventions that can be checked stop consuming review attention, which is then available for the ones that cannot.
- A violation surfaces while the author still has the context to fix it.
- A diagnostic that names its record turns enforcement into an explanation rather than a prohibition.

**Harder**

- Packages with existing violations fail until repaid, and the failure has to be tolerated rather than silenced.
- Suppressions accumulate and need periodic review, or they become the convention.
- Every custom rule is code the team maintains, including its false positives.

**Risk**

Enforcing the checkable minority may imply the unenforceable majority is optional. The rules are a floor, not a definition of conformance.
