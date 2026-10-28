# Fix: a workspace nested in a repository knows which root each path is relative to

## Objective

A run stamped into a subdirectory of a git repository resolves every path to the right file. Paths that come out of git are understood as relative to the VCS root; paths that come out of configuration — prompts, extensions, skills, `data_dir`, `writes` — stay relative to the workspace root; and a run states both roots when they differ. Work an Activity does above the workspace but inside the repository is recognised, reported as such, and committable.

The baseline is the repository after commit `49b2ab0`, which moved claim resolution from the orchestrator's `process.cwd()` to `run.repoRoot`. That change is correct and stays; it is the workspace-first half of the resolution this spec completes.

This separates two roots that are presently one variable. It does not move the workspace, does not change where configuration resolves, and does not forbid an Activity from writing outside the workspace.

## 1. Requirements

### 1.1 The run carries both roots

1.1.1 `TRun` MUST carry the VCS root alongside the workspace root. The existing `repoRoot` field names the workspace — the directory holding `.pi-crust/`, found by walking up from the process cwd (`runtime/modules/data/git.ts`) — and its meaning MUST NOT change.

1.1.2 A function MUST exist beside `repoRoot` that answers `git rev-parse --show-toplevel`, resolved from the workspace root. It MUST fall back to the workspace root when the directory is not inside a git repository, so an unversioned tree keeps working with both roots equal.

1.1.3 `createRun` MUST populate the VCS root once, at run creation, and every consumer MUST read it from the run rather than invoking git again. Two calls at different moments can disagree once a worktree is switched mid-run, and a root that changes underneath a comparison is worse than one that is wrong consistently.

1.1.4 The field names MUST say which root they mean. A reader MUST NOT have to know that `repoRoot` means the workspace while `git diff` output means the repository.

### 1.2 Git output is normalised where it enters

1.2.1 `snapshotTree` in `runtime/modules/data/working-tree.ts` MUST return paths that are unambiguous about their base. Its two sources — `git diff HEAD --numstat` and `git ls-files --others --exclude-standard` — both emit paths relative to the **VCS root** regardless of the `cwd` they are given, and today those strings are consumed as if they were relative to the workspace.

1.2.2 Normalisation MUST happen at that boundary rather than at each consumer. `changedPaths`, `enforcePermissions`, the claim gates, the checks gate, `claimedPaths` and `commitActivity` all read the same strings, and a convention each applies separately is a convention one of them will apply differently.

1.2.3 `repoRelative` and every other helper that converts an absolute path to a relative one MUST be given the root it is relativising against explicitly, with no default.

1.2.4 Setting `diff.relative` MUST NOT be the mechanism. It is a per-repository git configuration this tool does not own, it would change what every other tool in that repository reports, and a run that depends on it breaks silently wherever it is unset.

### 1.3 A claim resolves, and says where it resolved

1.3.1 `atRepoRoot` in `runtime/modules/use-cases/gates/claim-gates.ts` MUST resolve a relative claim against the workspace root first, then the VCS root, and treat the file as existing when either answers. Workspace-first is the behaviour commit `49b2ab0` landed and MUST be preserved; the VCS-root fallback is what this spec adds.

1.3.2 The gate check recorded for a resolved claim MUST name which root answered. A green check that does not say where it looked is what made the present failure unreadable.

1.3.3 A claim that resolves only outside the workspace MUST raise a warning naming the path and the root that answered. It MUST NOT fail the gate: a monorepo workspace may legitimately own work that lives above it, and the run's job is to report that, not to refuse it.

1.3.4 A claim that resolves under neither root MUST keep failing exactly as today, with the present `claimed changed file does not exist` message.

1.3.5 `artifactsExist`, `filesNonEmpty` and `jsonParses` MUST use the same resolution as 1.3.1. They share `atRepoRoot` today and MUST continue to share whatever replaces it.

### 1.4 Commits reach what the Activity changed

1.4.1 `commitPaths` in `runtime/modules/data/git.ts` MUST address paths from the VCS root. It currently invokes git with no `cwd`, so the orchestrator's process directory — the workspace — is what git resolves its pathspecs against, and a path above the workspace matches nothing.

1.4.2 A path that git cannot stage MUST continue to be reported rather than silently dropped. `commitActivity` already reports an uncommitted warning when the commit fails; the case 1.4.1 fixes is the quieter one, where the pathspec matches nothing and the commit reports `nothing to commit`.

1.4.3 `touchedBy` MUST pass `commitPaths` the same normalised paths that 1.2.1 produces, so what is committed is what the snapshot observed.

### 1.5 The run says so

1.5.1 When the workspace root and the VCS root differ, the run banner MUST print both, named. A developer MUST be able to see the nesting without reading a gate failure five activity runs deep.

1.5.2 The difference MUST be recorded on the session, so the visualizer and the reporter can show it for a run somebody reads later.

1.5.3 Neither MUST be presented as an error. A workspace nested in a monorepo is a supported layout — it is why `repoRoot` stopped being the git toplevel — and a warning that fires on every run of a correct configuration is a warning people learn to ignore.

### 1.6 Tests

1.6.1 A test MUST cover a workspace nested one level inside a git repository: a file changed above the workspace is snapshotted, resolved, reported as outside the workspace, and staged by a commit.

1.6.2 A test MUST show that a workspace equal to the VCS root behaves exactly as it does today, with no warning from 1.3.3 and no banner line from 1.5.1.

1.6.3 A test MUST show that a claim resolving under neither root still fails, covering 1.3.4.

1.6.4 A test MUST show that a tree with no git repository at all still runs, with both roots equal, covering 1.1.2.

1.6.5 A test MUST show that configuration paths — prompts, extensions, `data_dir`, `writes` — resolve against the workspace root and are unaffected by the VCS root, covering the boundary in section 3.

1.6.6 The four regression tests commit `49b2ab0` added to `runtime/modules/use-cases/gates/claim-gates.test.ts` MUST keep passing. Their fixture builds the workspace as the PARENT and the orchestrator's cwd as a `_newstack` child, which is the inverse of the layout that produced the failure — `.pi-crust/` sits in the child and the changed files in the parent. At least one test MUST model that real nesting, and the inverted fixture MUST be relabelled to say which case it covers rather than left implying it covers this one.

## 2. Target state

The two roots and the one conversion, stated once. Where this and the prose in section 1 disagree, section 1 governs.

```ts
/**
 * Where paths come from, and what each is relative to.
 *
 *   workspaceRoot  the directory holding .pi-crust/ — agents' cwd, and the
 *                  base for everything configuration names
 *   vcsRoot        git rev-parse --show-toplevel — the base for everything
 *                  git prints, whatever cwd git was given
 *
 * They are equal in the ordinary case. They differ when a workspace is one
 * package of a monorepo, which is a supported layout: the workspace is where
 * that package's conventions, skills and prompts live, and it is not where
 * git counts from.
 */
export type TRoots = Readonly<{ workspaceRoot: string; vcsRoot: string }>

/** A path as git printed it, made absolute before anything else sees it. */
export const fromGit = (roots: TRoots, printed: string): string =>
  resolve(roots.vcsRoot, printed)

/** A claim an agent wrote, resolved workspace-first and then repository-wide. */
export const resolveClaim = (
  roots: TRoots,
  claim: string,
): Readonly<{ path: string; root: 'workspace' | 'vcs' }> | undefined => {
  if (isAbsolute(claim)) {
    return fileExists(claim) ? { path: claim, root: 'vcs' } : undefined
  }
  const inWorkspace = join(roots.workspaceRoot, claim)
  if (fileExists(inWorkspace)) return { path: inWorkspace, root: 'workspace' }
  const inRepository = join(roots.vcsRoot, claim)

  return fileExists(inRepository)
    ? { path: inRepository, root: 'vcs' }
    : undefined
}
```

## 3. Out of scope

- **Where configuration resolves.** `data_dir`, prompts, harness extensions, skills and `writes` patterns are workspace-relative and stay workspace-relative. That is the decision recorded at `runtime/modules/data/git.ts`, where `repoRoot` was deliberately changed from the git toplevel because a nested workspace resolved every configured path against a directory that does not contain it.
- **Moving the stamp.** This work exists so a workspace can stay where it is. Nothing here re-stamps a repository at its toplevel, and no instruction to do so may be added to the install path.
- **Forbidding writes outside the workspace.** 1.3.3 reports them. Whether an Activity should be allowed to change files above its workspace is a roster question — `writes:` — and is not decided here.
- **The path policy's protected and ignored patterns.** `git check-ignore` is already run with an explicit cwd and answers correctly for both roots. The `.env*` matching question is separate and is not touched by this work.
- **`--scope`.** How a scope expression selects what the judging Activities judge is unchanged; it inherits whatever 1.2.1 produces, like every other consumer.
- **The trace schema.** 1.5.2 records a value on the session; if that needs a column, it is additive and no existing column changes meaning.
- **Commit `49b2ab0`.** It is not reverted, rewritten, or re-litigated. It fixes a case this spec does not address — an orchestrator invoked from a directory BELOW the workspace — and `atRepoRoot` is extended rather than replaced.
- **The run verdict.** [FIX-SUPERSEDED-RUN-VERDICT.md](FIX-SUPERSEDED-RUN-VERDICT.md) covers how a run is reported `fail`, including the runs this defect failed. Do not fold the two.

## 4. Work stages

| #   | Change                                                                                               | Proven by                                                                                                                                                                                                                                                                             |
| --- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 1.1.1–1.1.4, 2 — both roots on the run, named, resolved once                                         | `cd runtime && bun test modules/use-cases/create-run.test.ts && bun x tsc --noEmit`                                                                                                                                                                                                   |
| 2   | 1.2.1–1.2.4, 1.6.4 — git output normalised at the boundary                                           | `cd runtime && bun test modules/data/working-tree.test.ts`                                                                                                                                                                                                                            |
| 3   | 1.3.1–1.3.5, 1.6.3, 1.6.6 — claim resolution, saying which root answered, and the corrected fixtures | `cd runtime && bun test modules/use-cases/gates/claim-gates.test.ts`                                                                                                                                                                                                                  |
| 4   | 1.4.1–1.4.3 — commits address the VCS root                                                           | `cd runtime && bun test modules/data/git.test.ts modules/use-cases/deliver.test.ts`                                                                                                                                                                                                   |
| 5   | 1.5.1–1.5.3, 1.6.2, 1.6.5 — the banner, the session record, and the unchanged flat case              | `cd runtime && bun test`                                                                                                                                                                                                                                                              |
| 6   | 1.6.1 — the nested-workspace case, end to end over a scratch repository                              | `cd runtime && bun test modules/use-cases/enforce-permissions.test.ts`                                                                                                                                                                                                                |
| 7   | Whole-repository verification                                                                        | `(cd runtime && bun test && bun x tsc --noEmit)`; `(cd apps/visualizer && bun test && bun x tsc --noEmit && bun x vite build)`; `bun scripts/typecheck-harness.ts`                                                                                                                    |
| 8   | The failing repository runs green                                                                    | from `/Users/andrewwright/src/libsyn/platform-harden-spotify/_newstack`, `just crust run "re-verify the spotify-gateway container work" --activities code-review --scope .prodcontainer/spotify-gateway` reaches its envelope with no `claimed changed file does not exist` violation |

Stage 2 lands before stage 3 because a claim cannot be resolved honestly against a snapshot whose own base is ambiguous. Stage 8 is last because it is the only stage that spends money, and it is the only one that proves the defect is gone rather than that the code compiles.

## 5. Rationale

**What was observed.** Run `5b997324` in `/Users/andrewwright/src/libsyn/platform-harden-spotify/_newstack` failed its build gate three times with five violations of the form `.prodcontainer/spotify-gateway/Dockerfile: claimed changed file does not exist`. The files exist. They are at `/Users/andrewwright/src/libsyn/platform-harden-spotify/.prodcontainer/spotify-gateway/`, written between 23:01 and 23:03 on 27 October, and the trace records the writes succeeding at those absolute paths. The workspace is `_newstack`; the git toplevel is its parent.

**Why the claim could not resolve.** `git diff HEAD --numstat`, run with `cwd` set to `_newstack`, prints `.prodcontainer/spotify-gateway/Dockerfile` — relative to the toplevel, because that is git's default and `diff.relative` is unset. `atRepoRoot` joins that string onto the workspace root and looks for `_newstack/.prodcontainer/spotify-gateway/Dockerfile`, which has never existed. Both halves are individually correct; they disagree about what the string is relative to.

**Why the fix already in the tree does not close it.** Commit `49b2ab0` resolved claims against `run.repoRoot` instead of `process.cwd()`. For run `5b997324` those are the same directory: the orchestrator was launched from `_newstack`, and `repoRoot()` walks up to the nearest `.pi-crust/`, which is `_newstack` itself. The claim still resolves to `_newstack/.prodcontainer/spotify-gateway/Dockerfile`, which does not exist. Its tests pass because their fixture inverts the layout — workspace as parent, cwd as child — so they exercise a different nesting from the one that failed. The diagnosis recorded for that run, that the gate "resolves against the orchestrator process's own cwd rather than `run.repoRoot`", is true of the code it changed and does not describe this defect.

**Why the agent is not at fault.** It ran `git rev-parse --show-toplevel`, found `.prodcontainer/` where git said the repository begins, and wrote there. Asking a model to work in a directory while the tool around it measures from a different one produces exactly this, and it produces it as an accusation that the model invented files.

**Why the roots must stay separate.** The obvious repair — make `repoRoot` the git toplevel — is the implementation that was already removed, and its failure mode is recorded at `runtime/modules/data/git.ts`: a workspace at `<repo>/workspace/` resolves prompts, extensions and skills against `<repo>`, which does not contain them, and the symptom is `Failed to load extension` for a file that exists. In a monorepo the workspace is also where that package's conventions live, so hoisting the root would hand every agent a different package's instructions. Two roots is not a workaround; it is the honest shape of the problem.

**Why normalisation belongs at the boundary.** Six call sites consume `snapshotTree`'s output. A rule applied at each of them is a rule five of them will keep and one will forget, and the forgetting is invisible — a path that resolves to nothing reads exactly like a file that was never written.

**What else this is probably causing.** `commitPaths` invokes git with no `cwd`, so pathspecs resolve against the orchestrator's directory. A path above the workspace matches nothing, `committable` comes back empty, and the commit reports `nothing to commit` rather than failing. That is consistent with work from these runs sitting uncommitted in the tree, though it has not been reproduced in isolation and 1.6.1 is what would settle it.

**Rejected: refusing writes above the workspace.** It would turn this into a loud failure instead of a silent one, and it would be wrong for the repository that produced it: the spec being executed is about container configuration that lives at the monorepo root. A workspace is where an Activity's conventions come from, not a sandbox its work may not leave.

**Rejected: resolving claims against the VCS root only.** Simpler, and it breaks the flat case — a claim naming a path that exists at both roots would resolve to the wrong one in every single-package repository, which is almost all of them. Workspace-first keeps today's behaviour exactly where today's behaviour is right.
