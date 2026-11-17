# Identification Prompt Examples

Both problems came up while reviewing pi-crust pull request #165, which moved permission enforcement's after-state reads into `executeAgent`. The developer asked whether a change fixed a bug, and the answer exposed two problems unrelated to the pull request. The developer asked for prompts that would log them through the `gh-issue` lifecycle.

The first drafts were written as instructions to an investigating agent. They pass the checker, but they fail Step 3: they address the harness, prescribe a fix, and cite line numbers from an unmerged branch.

## Committed edits escape permission enforcement

### First draft, and what was wrong with it

The first draft began "Investigate whether pi-crust's permission check misses…", told the agent to "Reproduce this with a throwaway git repository under `mktemp -d`", and ended "Report what you observed and propose a fix with a test that proves it". It had three faults:

- It addressed an agent that the `gh-issue` lifecycle never runs. Identify writes an outcome. It does not reproduce anything.
- It led with the mechanism instead of the consequence for people using pi-crust: a write nobody permitted goes unreported.
- It did not say that the gap was inferred from reading code and had not been reproduced, so the issue would have presented a hypothesis as a finding.

### Rewritten

````text
An agent can write outside its `writes` allowlist without the write being reported, if it commits that write during its Activity. `enforcePermissions` in `runtime/domains/policy/src/use-cases/enforce-permissions.ts` decides what an Activity touched by comparing two records of uncommitted changes, taken by `executeAgent` in `runtime/domains/activities/src/use-cases/execute-agent.ts` before and after the agent runs. Each record comes from `snapshotTree` in `runtime/domains/workspace/src/data/working-tree.ts`, which lists `git diff HEAD --numstat` plus untracked files, so a file that was clean before the Activity and was committed by the agent appears in neither record; `commitBreach` reports that HEAD moved but not which paths the commit contained. This was inferred from reading the code while reviewing pull request #165 and has not been reproduced. The outcome wanted is that every path an Activity changes, committed or not, is attributed to that Activity and checked against its allowlist. Not yet established: whether the path policy armed during the agent's run already blocks such a write; whether the same gap applies to a file that was already dirty, to a new file, and to an Activity that is allowed to commit; and whether `rev('HEAD')`, which runs in the process's working directory rather than in the run's repository root, can compare HEAD in the wrong repository. A possible approach, not a requirement, is to add the paths that differ between HEAD before and HEAD after to what the Activity touched. Out of scope: rolling commits back, which `commitBreach` deliberately does not do.
````

## Default branch assumed to be `main`

### First draft, and what was wrong with it

The first draft ended "Then replace the hardcoded fallback with the repository's actual default branch, resolving it from an explicit flag, then config, then `git symbolic-ref refs/remotes/<remote>/HEAD`, then `main`. Add tests that prove…". It had three faults:

- It made the fix the request. Identify would have recorded a resolution order as the outcome, and the issue would read as a task to implement one design, not a problem to solve.
- It cited `activity.ts:222` and `select-range.ts:91`. Those line numbers were correct on one branch at one commit and will drift.
- It did not rank the failure modes. A run that diffs against a wrong but valid ref, with no error, is worse than one that fails loudly, and the issue should say so.

### Rewritten

````text
pi-crust assumes the default branch of every repository it is stamped into is `main`, but a stamped repository may use `dev`, `latest`, `master` or another name. The literal `main` is the fallback for the pull request base (`deliverySchema` and `terminalConfigSchema` in `runtime/lib/contracts/src/activity.ts`), for the base an Activity's change is measured against (`changeCapture` in `runtime/lib/contracts/src/changes.ts`, used by `capturedChanges` in `runtime/domains/activities/src/use-cases/agent-activity.ts`), and for the empty left side of a range (`splitRange` in `runtime/domains/workspace/src/use-cases/select-range.ts`, whose comment says it applies git's defaults although git fills an empty side with HEAD); it is also written as `base: main` into the stamped `templates/stamp/config/crust.activities.yaml`. The outcome wanted is that in a repository whose default branch is not `main`, pull requests target that branch and changes are measured against it without the operator configuring anything, while an explicitly given base still wins. Not yet established: whether that list is complete; what each place does when no `main` exists, whether that is a clear failure, a silent fallback, or a diff against a wrong but valid ref (the last is the most dangerous, because nothing reports it); which places already honour a flag or a config value; and whether pi-crust already resolves a default branch elsewhere, such as in `runtime/domains/activities/src/use-cases/gh-pull-request.ts`. A possible approach, not a requirement, is to resolve the base from an explicit flag, then config, then the remote's HEAD ref, then `main`. Out of scope: renaming branches in any repository, and rewriting the stamped config directory of repositories that are already stamped, which updates deliberately leave alone.
````
