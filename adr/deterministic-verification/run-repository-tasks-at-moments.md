---
Context: All apps
---

# Run repository tasks at moments in the run

## Status

accepted

Supersedes [Route verification by changed paths, not position](./route-verification-by-changed-paths.md).

## Decision

A repository declares its deterministic commands once, as **tasks**, and each task says when it runs. A task's `when` holds one or more triggers:

| Trigger                 | Fires                                                                                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `on = "change"`         | After any Activity changes repository files, before that work is accepted, whether or not the work is then committed                            |
| `on = "deliver"`        | Once, before the run's branch is delivered; at the end of the run when no Activity delivers it; never in a run that changed no repository files |
| `before = "<activity>"` | Before the stage containing that Activity starts                                                                                                |
| `after = "<activity>"`  | After the stage containing that Activity finishes                                                                                               |

`skip`, valid only beside `on`, names the Activities a task does not answer for. At `change`, paths written by a skipped Activity are left out of the task's selection. At `deliver`, the task does not run when the last Activity that changed files is skipped. Names match an Activity's canonical name, so a numbered re-run or an alias of a skipped Activity is skipped too. A name in `skip` that is not defined on the machine running the task is ignored; a name in `before` or `after` that is not defined is a load error that names the task and the Activities that are defined.

A task selects paths with `match` globs over the changed paths that still exist. A task whose `match` selects none does not run. Its command is a shell string, or a list of shell strings. Every command in a list runs, and every failure is reported. Two variables are substituted, each value shell-quoted: `{{changed_paths}}`, the selected paths, and `{{base_ref}}`, the revision the changed paths are measured from. A task may name a `cwd` below the repository root, and the paths it receives are rebased onto it.

A failure is routed by when it happened, and no configuration names where it goes:

| Failed at             | Goes to                                                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `change` or `after`   | The next attempt of each Activity whose changed paths the task selected, as gate feedback, aggregated at the stage boundary |
| `deliver` or `before` | The last Activity that changed files, by regressing the run to it; everything after it runs again                           |

Both spend the receiving Activity's attempts.

The engine's own checks of an Activity's output are not configured anywhere. Checks over declared artifacts run after every Activity. Checks that read fields of one output schema run on every Activity that reports that schema.

A commit a git hook refuses stays a warning, retried later in the run, and never becomes task feedback.

Rejected alternatives, with the reasons in Context:

| Rejected                                        | Instead                                                    |
| ----------------------------------------------- | ---------------------------------------------------------- |
| Triggers attached to lifecycle stages           | Triggers that a chain composed on the command line reaches |
| Git hooks as the home for tasks                 | Tasks the engine runs and reports back to an agent         |
| A flag that exempts an Activity from every task | `skip` on each task                                        |
| A configured regression target                  | The last Activity that changed files                       |
| An argument list with changed paths appended    | A shell command with substituted, quoted variables         |

## Context

The superseded record kept one registry of commands, selected by changed paths and opted into per Activity by naming a gate. Using it surfaced problems that its design could not answer.

The word **gate** covered two unrelated things: the engine's checks of an Activity's own output, and the repository's commands. It also reads as a check before entry, while every gate runs after the Activity. Most of the confusion in configuring a repository traced back to that one word.

Opting in was all or nothing. An Activity that named the gate got every matching command, so a repository could not run tests over the changed files after implementation and the whole suite before delivery. Changed paths reached a command only by being appended to its argument list, which also ruled out pipes.

The superseded record rejected per-Activity `before` and `after` hooks for two reasons. Hooks raced with concurrent siblings, and the same hook had to be restated in every lifecycle. Neither holds here. A trigger waits for the stage boundary, as the gate already did, and failures from concurrent siblings are aggregated the way review verdicts are. Tasks are declared once per repository, not per lifecycle. That record's test for later proposals was to add a moment rather than a vocabulary. `on` adds moments. `before` and `after` do add vocabulary, accepted because a repository can need a command exactly around one Activity. The end-of-run evaluation that record anticipated is `deliver`.

Triggers on lifecycle stages were rejected because a chain composed on the command line has no lifecycle, so its tasks would never run.

Git hooks were rejected as the home for tasks. A refused commit reaches no agent, commits can be disabled for a run, and a hook only sees committed work. Hooks are not suppressed either. A run is meant to finish unattended, and landing its work in history is secondary, so a refused commit warns and the work stays in the tree for a person to commit afterwards.

An exemption flag on an Activity was rejected as too broad. An Activity whose purpose is a failing test, such as a reproduction or a test written before the implementation, should still be linted; it should not be held to a passing suite. Without `skip`, `change` would tell that Activity to make its tests pass, and `deliver` would regress a run that ended on it back into it, with the same instruction. Either destroys the work the Activity exists to produce.

Unknown names are treated differently on purpose. A mistyped `skip` entry makes a task run where it should not, and that fails visibly. A mistyped `before` or `after` entry makes a task never run, and nothing would report it.

A configured regression target was rejected as a place for configuration errors with no benefit; the last Activity that changed files is almost always the one that should answer.

The command shape follows the established task-runner convention: a shell string or a list of them, with substituted values quoted. It departs from that convention in one place. A task runner stops a list at the first failure, but here every command runs, because the output becomes an agent's feedback and partial feedback spends attempts on failures the agent was never shown.

The changed paths an Activity is observed to produce include deletions. A deleted path handed to a command fails on a file that does not exist, which is why selection considers only paths that still exist.

## Consequences

A repository's verification is still read in one place, and the place is still the repository's task declarations. What changes is that a task now says when it runs, so an Activity definition no longer names repository commands and a reader no longer cross-references the two.

An Activity added on one machine is covered by `on = "change"` with no repository edit. If it writes tests that fail on purpose, it has to be added to the relevant `skip` lists, and until it is, the omission fails visibly rather than passing silently.

`skip` names Activities that are defined outside the repository. The stamped default declares the tasks commented out, with their triggers and `skip` lists filled in and their commands left to the repository, because a placeholder command would make a fresh install fail its first run. A repository that declares no tasks runs none and says so.

Regressing on a `deliver` failure re-runs the last writing Activity and everything after it. That is the most expensive recovery the run has, bounded by that Activity's attempts.

Silence is still never read as coverage. When changed paths reach no task, the run's summary says how many, with no setting to turn that into a failure. The old setting existed because the gate failed or warned on uncovered paths; with tasks, nothing fails because no task matched, so reporting the number is the whole of the rule.

Selecting skills by changed path, which the superseded record also governed, is withdrawn rather than carried over. The coding agent already lists every skill its environment can discover and loads one only when the task calls for it, and a skill named on its command line joins that same list rather than being loaded. Naming a discoverable skill again changed nothing, and naming one outside discovery only added it to the list. A skill an Activity needs belongs where the agent discovers skills.
