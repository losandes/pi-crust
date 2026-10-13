# Fix: the working tree belongs to the developer

## Objective

pi-crust never changes a file back on its own, and never commits a file it did not touch. A developer writing code in the same branch while a run works is a supported way to use this tool, so what pi-crust cannot attribute it reports rather than acts on. What it CAN attribute — a tool call reaching a protected or gitignored path — it refuses before the call runs, because a secret that has been read cannot be unread.

One document, in landing order. The three concerns are separable in principle and were drafted as three specs; they are one here because the order they must land in interleaves them, and a stage that cites a requirement in another document is a stage nobody can run on its own.

## 1. Requirements

### 1.1 Nothing is reverted

1.1.1 `rollBack` in `modules/use-cases/enforce-permissions.ts:213` MUST stop changing the working tree. It currently runs `git checkout -- <path>` on a tracked file, which discards uncommitted content with no recovery path, and deletes a path that was untracked.

1.1.2 No code path MUST revert, delete, restore or check out a file because of what an Activity did or did not report. A developer's edit in the same tree is indistinguishable from an agent's, and pi-crust guessing wrong destroys work.

1.1.3 `commitBreach` (`enforce-permissions.ts:271`) MUST keep reporting a moved `HEAD` and MUST keep leaving history alone. Its existing reasoning — resetting history under a developer is a bigger harm than the commit was — now applies to files as well.

1.1.4 `enforcePermissions` MUST keep computing the observed path set and MUST keep returning it. Everything below consumes it.

### 1.2 A run commits what it touched, and nothing else

1.2.1 A commit made for an Activity MUST stage paths explicitly. `commitAll` in `modules/data/git.ts:86` runs `git add -A` and commits the entire working tree, so every uncommitted file in the repository is currently swept into the first Activity that declares `commit: true`.

1.2.2 The staged set MUST be the paths that Activity Run was OBSERVED to change. `execute-agent.ts:546` records exactly this as the `paths_touched` event and then discards it.

1.2.3 A path that was dirty when the run started and that no Activity wrote to MUST NOT be staged, committed, or reported as part of the run.

1.2.4 A path that was dirty when the run started and that an Activity DID write to MUST be staged. An Activity may pull a dirty file into scope by working on it; it may not pull one in by running near it.

1.2.5 Observation MUST govern, not the envelope. `changed_files` is the Activity's own claim and is used by 1.3 to report a disagreement, but it MUST NOT decide what is staged: an Activity that under-reports would leave its own work uncommitted, and one that over-reports would commit somebody else's.

1.2.6 An empty scope MUST NOT be an error. `commitActivity` already treats "nothing to commit" as a normal outcome and MUST keep doing so.

1.2.7 The `committed` trace event MUST carry the paths that went into the commit, and the console note MUST say how many there were. A commit of six files and a commit of sixty are currently indistinguishable without leaving the terminal.

1.2.8 Attribution under a concurrent Stage MUST remain by declared path, as `run-activities.ts:127` arranges through `cohort`. An Activity MUST NOT stage a path a sibling declared.

### 1.3 An unexplained change is a warning, not a failure

1.3.1 An Activity Run MUST record the paths already dirty when it STARTED, and MUST carry that set forward as something a reader can see.

1.3.2 When an Activity Run ends, pi-crust MUST compare the paths observed to have changed against the Activity's self-reported `changed_files`, excluding paths that were already dirty when it started.

1.3.3 A path that changed, was not already dirty, and was not self-reported MUST produce a warning naming the path, the Activity, and the Activity Run.

1.3.4 A warning MUST NOT stop the run, fail the Activity Run, consume an attempt, or open a human gate.

1.3.5 A warning MUST say that pi-crust cannot tell whether the change was the agent's or the developer's. It is a report of a disagreement between two records, not an accusation.

1.3.6 Warnings MUST survive to the end of the run. One raised by the second of nine Activities is still shown when the ninth finishes.

1.3.7 A warning MUST be recorded in the trace, so every surface reads one record rather than recomputing it.

1.3.8 The final console output (`report-to-console.ts:77`), `just crust report <run_id>`, the visualizer's session screen with no Activity selected, and the visualizer's Activity screen for the Activity that raised it MUST each list the warnings that belong to them.

1.3.9 A path nobody declared that changes during a concurrent Stage MUST raise ONE warning for the Stage, naming the Activities that were running, rather than one warning per Activity saying the same thing.

1.3.10 A path governed by 1.4 MUST NOT be handled here. pi-crust cannot attribute a change in a diff and can attribute a tool call exactly, which is what makes the two different classes with different answers.

### 1.4 A protected path is refused before it is touched

1.4.1 A protected path MUST be enforced through pi's `tool_call` event, which can block execution before a tool runs. Enforcement today is entirely post-hoc, so the earliest it can know is after the bytes have been read or written.

1.4.2 A refused call MUST tell the agent what was refused and why, so it reports the refusal in its envelope rather than failing in a way nobody can read.

1.4.3 A refusal MUST be recorded in the trace and MUST reach the same surfaces as 1.3.8.

1.4.4 Blocking MUST NOT revert, delete or restore anything. There is nothing to undo, which is the point of acting before rather than after.

1.4.5 A protected path MUST be enforceable on READ as well as on write, and the two MUST be configurable independently. `protected_files` governs writes only today, and for a credentials file reading is the dangerous half.

1.4.6 `crust.config.yaml` MUST carry the policy, with the four verbs in section 2 and no others. `revert` MUST NOT be one of them.

1.4.7 The shipped default MUST be `block` for both read and write. It is the only verb that protects rather than reports, and a protection mechanism MUST fail closed.

1.4.8 `protected_files` MUST keep working as the list of paths, because `config/` is skipped by an update and a renamed key would be a silent downgrade.

1.4.9 The shipped list MUST protect env files at every depth. `*` does not cross `/` and `**` does, so `.env*` and `**/.env*` are both required — verified against `matchesPattern`, where `**/.env*` alone does not match a root `.env`.

### 1.5 Gitignored files are not pi-crust's to touch

1.5.1 An agent MUST NOT read or write a gitignored path. A file a repository has deliberately excluded is local, generated or secret, and none of those are an Activity's business.

1.5.2 The run's own session runtime under `data_dir` MUST be exempt. It is gitignored by design and is where handoff documents, envelopes, prompts and raw output legitimately land.

1.5.3 The ignored-path rule MUST take the same policy verbs as a protected path, and MUST be separately configurable. One is a list a team wrote; the other is whatever `.gitignore` happens to say today.

1.5.4 The shipped default MUST be `warn` on read and `block` on write. Reading a generated file is ordinary work; writing one produces output no diff, review or commit will ever show.

1.5.5 Membership MUST be decided by git, not by re-implementing `.gitignore` matching.

### 1.6 What cannot be protected this way

1.6.1 `bash` MUST be covered on a best-effort basis only, and the limit MUST be documented where the policy is declared. `read`, `write` and `edit` carry a structured path and can be matched exactly; a shell command is a string, and `cat .env`, `grep -r KEY .` and `env > dump` are not reliably distinguishable from legitimate work.

1.6.2 A team that must not leak a path MUST be told the sound answer: do not give that Activity `bash`. A partial defence described as protection is worse than none.

## 2. Target state

This is the only place these three rules appear. Where this section and the prose in section 1 disagree, section 1 governs.

**What a commit contains.**

```text
at run start        record every path already dirty            -> DIRTY_AT_START
per Activity Run    enforcePermissions returns observed paths  -> TOUCHED
commit scope        TOUCHED                                     (nothing else)
```

```sh
git add -- <TOUCHED...>     # never `git add -A`
git commit -m "<message>"   # only when the staged set is non-empty
```

**What raises a warning.**

```text
at Activity Run start   paths already dirty             -> DIRTY_BEFORE
at Activity Run end     paths observed to have changed  -> TOUCHED
from the envelope       changed_files                   -> CLAIMED

unexpected = TOUCHED - CLAIMED - DIRTY_BEFORE
```

```text
⚠ 2 unexpected change(s) during this run

  build (02_build)
    - src/add.ts
    - docs/notes.md

  These files changed while the Activity ran and it did not report them.
  They may be the Activity's work, or yours — pi-crust cannot tell.
  Nothing was changed back.
```

**What is refused.**

```yaml
defaults:
  # The list keeps its name, so a stamped config needs no edit.
  protected_files:
    - .pi-crust/config/
    - .env*          # .env, .env.production, .envrc, .envrc.local at the root
    - '**/.env*'     # and the same names in every directory below it
  protected:
    read: block      # block | stop | warn | allow
    write: block
  ignored:           # whatever .gitignore says, minus this run's data_dir
    read: warn
    write: block
```

```text
block   refused before the call runs. Nothing is read, nothing is written.
        The agent is told, and the refusal is reported.
stop    it happened; the run ends at that Activity, loudly.
warn    it happened; reported with every other warning; the run continues.
allow   not governed. A path nobody wants governed should leave the list.
```

## 3. Out of scope

Do not add reverting back, under any verb or any name, at any point in any stage below.

Do not change `commit: true`, `--commit false`, or which Activities commit. Delivery as a property of an Activity was settled by [FIX-INCOMPLETE-OPEN-CLOSED.md](completed/FIX-INCOMPLETE-OPEN-CLOSED.md). Do not add a branch mode, a patch mode, or any other delivery mode.

Do not change the envelope schemas. `changed_files` keeps its name and meaning.

Do not change what `writes:` means, or how a path is matched against it. `matchesPattern` and `globToRegExp` are unchanged, and this is not a way to restrict an Activity's own `writes` list.

Do not add a gate, a decision verb, or an approve/revert prompt. A warning is not a question, and the run does not wait for it.

Do not make the trust dial able to silence a warning or soften a policy. Trust governs what a run decides for itself; these are reports to a person.

Do not attempt to detect secrets by content. A path is a decision a team makes.

## 4. Work stages

Each stage is one run and lands on its own, in this order. The command named is the one that settles it.

| #   | Change                                                                  | Proven by                                                                                                                                             |
| --- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 1.1 — nothing is reverted                                               | `cd runtime && bun test`: a file changed outside an Activity's `writes` still holds its new content afterwards, and the run did not fail on it        |
| 2   | 1.2.1, 1.2.2, 1.2.3 — stage by path                                     | `cd runtime && bun test`: a dirty file no Activity touched is still dirty, and uncommitted, after a committing Activity ran                           |
| 3   | 1.2.4, 1.2.7, 1.2.8 — scope, reported, and concurrency-safe             | `cd runtime && bun test`: a touched dirty file IS committed, the `committed` event carries the paths, a sibling's path is not staged by its neighbour |
| 4   | 1.3.1, 1.3.2, 1.3.3 — the comparison                                    | `cd runtime && bun test`: unexpected paths warn; already-dirty and self-reported paths do not; the Activity Run is still successful                   |
| 5   | 1.3.4, 1.3.5, 1.3.6, 1.3.7, 1.3.9 — the warning, and the run carries on | `cd runtime && bun test`: a warning spends no attempt and opens no gate, survives to the end, and a concurrent Stage raises one not several           |
| 6   | 1.3.8 — the terminal and the report                                     | `cd runtime && bun test` over the rendered output, plus `just crust report <run_id>` on a run that warned                                             |
| 7   | 1.3.8 — the visualizer                                                  | `(cd apps/visualizer && bun test && bun x tsc --noEmit && bun x vite build)`, plus `just crust observe` against a run that warned                     |
| 8   | 1.4.6, 1.4.7, 1.5.3, 1.5.4 — the policy schema and defaults             | `cd runtime && bun test`: a config with no policy loads the shipped defaults, and an unknown verb is refused at load naming the four                  |
| 9   | 1.4.1, 1.4.2, 1.4.4, 1.4.5 — the extension that blocks                  | `cd runtime && bun test` over the handler: a read and a write of a protected path are both refused, an ordinary path is not                           |
| 10  | 1.5.1, 1.5.2, 1.5.5 — ignored paths, exempting `data_dir`               | `cd runtime && bun test`: a gitignored file is refused, a handoff document under `data_dir` is not                                                    |
| 11  | 1.4.3 — a refusal reaches every surface                                 | `cd runtime && bun test`, plus `just crust report <run_id>` and `just crust observe` on a run that refused                                            |
| 12  | 1.4.9, 1.6 — the shipped list, and the bash limit in writing            | `probe="$(mktemp -d)" && (cd "$probe" && bun "$OLDPWD/scripts/install.ts" && "$OLDPWD/scripts/verify-install.sh"); rm -rf "$probe"`                   |

Stage 1 first because it is the only one closing an active data-loss path, and it is a deletion. Stage 2 lands the plumbing — carrying the observed path set forward instead of discarding it — that stages 3 to 7 extend rather than rebuild. Stages 8 to 12 are new capability and come last.

Stage 12's requirement 1.4.9 is already satisfied by the shipped list; the stage exists so that a later edit to it cannot quietly stop matching.

## 5. Rationale

### 5.1 Why reverting has to go

The attribution is unsound and always was. The tree is compared before and after an Activity, and everything that changed in between is treated as the agent's — a rule the code already knows is false for concurrent siblings, which it fixes by declared path, and which is equally false for the developer, for whom it has no answer at all.

Observed: a developer edited `crust.config.yaml` while two Activities were live. Both reported it, the first ran `git checkout` on it, and the edit was gone — not in git, not in a stash, not recoverable. The file was back at its committed state with no record of what had been in it.

The rule that replaces it is the simple one: pi-crust reports, the developer decides. A `git checkout` is one command, and the developer can run it knowing what they are discarding. pi-crust cannot know.

### 5.2 Why `git add -A` is urgent

The first Activity declaring `commit: true` commits the developer's unrelated work in progress, under a message describing something else, attributed to a run that did not do it. Nothing warns, and the only evidence is in the commit itself. A developer who commits before every run never sees it; one who does not loses the ability to tell their work from the factory's.

### 5.3 Why observation and not the envelope

An agent's `changed_files` is a claim, and the gate that reads it (`diffMatchesClaims`, `claim-gates.ts:85`) checks only that each claimed file EXISTS — not that the claim is complete. An Activity that forgot to mention a file it wrote would leave that file uncommitted and dirty, and the next Activity would commit it under the wrong message. The tree is the record of what happened; the envelope is the report about it, and only one of them is evidence.

### 5.4 Why a dirty file can be pulled into scope

Refusing to commit any file that was dirty before the run sounds safer and is worse. A developer who starts a run to finish something they began by hand would watch the Activity's own work go uncommitted, with no way to say "yes, that one too" short of committing first and running again.

### 5.5 Why a warning and not a gate

A gate stops the run and asks. That is right for a question only a person can answer about the work; it is wrong here, because the overwhelmingly common cause is a developer typing in their own repository — which is a supported way to work, not an incident. A run that halted every time somebody saved a file would be unusable in the tree they are actually in.

The cost is that a genuine overstep by an agent no longer stops the chain. That is accepted: the detection is unchanged, the record is unchanged, and what was lost was a response that was wrong about half the time and destructive every time. It is also smaller than it looks, because the paths most worth defending stop relying on this mechanism at all — 1.4 refuses them before the call, where pi-crust knows whose call it was.

### 5.6 Why the comparison needs all three sets

`TOUCHED` alone warns about the developer's unrelated edits forever. `TOUCHED - CLAIMED` alone warns about everything already dirty before the Activity started, which is the same noise. Subtracting both leaves the one interesting set: something changed, during this Activity, that was not already changing, and the Activity did not mention it.

It still cannot attribute. Two things put a path in that set — an agent writing without reporting, and a developer saving a file mid-Activity — and nothing in the tree distinguishes them. 1.3.5 requires the warning to say so, because a message implying otherwise would teach developers to distrust it.

### 5.7 Why `protected_files` protects nothing today

`snapshotTree` is `git diff HEAD --numstat` plus `ls-files --others --exclude-standard`, and its own docstring says gitignored paths never appear. `.env` is gitignored in any sane repository, so a write to it is invisible: no breach, no report, nothing. The mechanism silently excludes the exact class of file it is most wanted for, and nobody would discover that until it mattered. So 1.4 is not a change of consequence — it is the first time the thing works.

### 5.8 Why block is the default

The other three verbs report an exposure that has already happened. For a credentials file that is not a lesser protection, it is no protection — the bytes are in a model's context, in its session on disk, and possibly in a provider's logs. `stop` and `warn` exist for teams who want the audit trail without the interference, and for paths like the repository's own config where reading is reasonable.

A refused call is also better for the agent than anything post-hoc. It is told, in the turn where it asked, that the path is off limits — and reports that in its envelope — where a silent revert left it believing it had written something.

### 5.9 Why gitignored files get a different default

Reading a generated file is ordinary: a build output, a lockfile, a local fixture. Blocking reads would break real work for no gain. Writing one is different — the output is not in the repository, so no review, no diff and no commit will ever show it, and an Activity that produced its work there has produced work nobody can see.

The exemption for `data_dir` is not a special case bolted on; it is the same exemption `writes:` already makes, for the same reason: the run's own record of itself is gitignored by design.

### 5.10 Why bash is admitted as a hole rather than papered over

A `tool_call` handler sees bash's input as a command string. Matching it means matching shell, and shell has as many spellings as a model can invent. Blocking the obvious ones would raise the apparent guarantee without raising the real one, which is the failure mode worth avoiding: a team that believes `.env` cannot be read will put things in it that assume so.
