---
Context: All apps
---

# Route verification by changed paths, not position

## Status

accepted

## Decision

Deterministic verification and skill selection stay in one registry, declared once per repository, selected by the paths a change actually touched, and opted into by name where an Activity should answer for them. A command that needs to know what the work changed, or what the state was before it, discovers that from version control rather than from a hook that ran earlier in the chain.

Four alternatives are rejected, and the reasons are in Context:

| Rejected                                                                        | Instead                                                                                                    |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Per-Activity `before`/`after` script hooks                                      | Declare the command in the registry; the Activity names the gate that runs it                              |
| A second configuration section for run-level acceptance, parallel to the checks | One registry; the moment it is evaluated is a property of the engine, not a second vocabulary              |
| A declaration of what an Activity produces, separate from what it may write     | The write boundary is the only declaration; intent that nothing enforces is a comment with a schema        |
| Refusing a chain at composition time for lacking a test-producing Activity      | Judge the work, not the shape of the chain                                                                 |

An Activity is not expected to produce work outside its stated purpose because no other Activity in the chain will. A chain that must produce tests names an Activity that writes tests. An implementation Activity may or may not write them, and no part of the system should be designed as though it reliably will.

## Context

The question that prompted this was how to hold a run to a coverage target. Coverage is a property of the finished work, but the obvious places to enforce it are all positions in a chain: after the builder, before the reviewer, inside whichever Activity happened to write the tests. Each candidate turned out to encode an assumption about chain order that the system deliberately does not make, because the chain is configuration and an engineer may run any ordered subset of Activities.

A related question was whether an implementation Activity should write tests when no test Activity is present in the run. Inspecting the shipped prompts settled it: nothing asks the implementation Activity for tests, nothing forbids it, its write boundary permits it, and a sample value in its report format shows a test file among the changed files. The behaviour is therefore undetermined — not guaranteed, not prevented, and sensitive to which model is running. A guarantee had to come from somewhere that does not depend on a prompt.

**Per-Activity hooks** were the most intuitive option and failed on concurrency. Deterministic checks already wait for the boundary at which concurrent siblings have finished, because a command that reads the working tree while another Activity is still writing to it reads a state nobody authored. A hook whose contract is "wraps this Activity" either reintroduces that race or means "after the stage", at which point it no longer wraps the Activity and the model that made it attractive is gone. The option also reintroduced position dependence directly: the same coverage check belongs after the implementation Activity in one lifecycle and after the test Activity in another, so the configuration would have to be restated per lifecycle. The `before` half is the part worth keeping in mind — gathering a baseline before any Activity runs is a real capability with no current home — but it is a run-level concern, not a per-Activity one, and the example that motivated it is obtainable from version control.

**A parallel acceptance section** was rejected as a synonym. Two configuration sections holding commands selected by changed paths, differing only in when they are evaluated, give a reader two vocabularies for one concept and two places to look for the answer to "what does this repository verify". The moment of evaluation is an engine concern.

**A separate declaration of intent** was rejected for the same reason, and for a stronger one: where an Activity's write boundary is unrestricted, the author of that Activity does not know what it will produce, so a declaration of intent buys nothing that could be enforced.

**Composition-time refusal** was rejected as unsound. Whether a chain can satisfy a rule about changed paths depends on what the run will change, which is not knowable before it changes it. A read-only investigative Activity changes nothing and would be refused by a rule about tests accompanying source; a documentation change would be refused by a rule about a language it never touches. Static analysis of chain shape produces confident refusals of legitimate runs.

The constraint running underneath all of these is that this factory is stamped into repositories whose conventions and toolchain it cannot know. A skill path or a checker command may be named in configuration and nowhere else. That constraint is satisfied by the current registry and would have been satisfied by every alternative; it is recorded here because it is why the registry is generic in the first place, and why a future proposal to make it more specific should be read carefully.

Two properties of the existing design turned out to be load-bearing in the discussion and are easy to lose by accident. The registry can be executed on its own, with no run, no session and no agent, which is what makes a pre-review sweep possible; a registry scattered across Activities cannot be. And selection by changed paths means a rule costs nothing on a run that does not touch what it governs, which is what lets one declaration serve every Activity.

## Consequences

Keeping one registry keeps one answer to "what does this repository verify", keeps that answer runnable outside a run, and keeps a rule's cost proportional to what a change touched. The price is that an Activity is not self-contained: reading what an Activity will be held to requires reading its gate list and the registry together. That is a real ergonomic cost, accepted deliberately, and the thing to watch for is a future reader proposing colocation without knowing it was considered.

A command that needs the state before the work discovers it from version control. This is more work for the author of a check than receiving a prepared baseline, and it has a sharp edge: a check that compares against a base reference must agree with the run about what that reference is, and nothing currently guarantees that agreement. Where a check cannot discover what it needs, the gap is in what the run makes available to a command, and should be closed there rather than by adding a hook that runs earlier.

Declining to refuse chains at composition time means a chain that cannot satisfy a declared rule is discovered when the rule is evaluated, after the work has been paid for. This is the accepted cost of never refusing a legitimate run, and it is bounded: the failure names the rule, and the engineer composes a different chain.

Nothing here provides a guarantee about the run as a whole. Deterministic checks are judged where an Activity opts into them, so a property that is only true of the finished work — a coverage floor, a rule that changed source is accompanied by changed tests — has no home that is independent of chain position. This is a known limitation rather than an oversight, and the shape of a solution is visible: evaluate the same registry once more over the whole change at the end, and let the run's acceptance depend on it. That would add a moment, not a vocabulary, which is the test any future proposal in this area should pass.

The carve-out: none of this governs a repository that has declared no rules. A registry with nothing in it verifies nothing and says so, and an engineer who wants a guarantee opts in by declaring one. Silence is never read as coverage.
