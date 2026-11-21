# Centralize a Worktree's Data

Configure the machine once, create worktrees freely, delete them without losing a single run.

## The problem

A developer who works in a git worktree per issue has, by default, a `.pi-crust/data` directory per worktree. Deleting the worktree when the issue is done deletes that run history with it — the trace rows, the session directories, the check logs — because nothing outside the worktree knows the data ever existed.

## The fix: a machine-level `override:`

`~/.pi-crust/config/crust.config.yaml` is read by every repository on this machine. Its `override:` section beats a repository's own `crust.config.yaml`, deliberately — see `references/config.md` for the whole precedence chain. Put this in it once:

```yaml
# ~/.pi-crust/config/crust.config.yaml — this machine, never committed

override:
  defaults:
    data_dir: "{primary_worktree}/.pi-crust/data"
  observability:
    db: "{primary_worktree}/.pi-crust/data/crust.db"
```

`{primary_worktree}` expands to `dirname($(git rev-parse --git-common-dir))`, resolved absolute — the main clone a linked worktree was branched from. In the main clone itself it is just the clone. Nothing about the token depends on which repository it is evaluated in, which is why one line in one file covers every clone on the machine, including ones not cloned yet.

## Using it

```bash
# in your main clone, already stamped:
git worktree add ../pi-crust-issue-42 -b issue-42
cd ../pi-crust-issue-42 && just crust run "fix the retry bug" --lifecycle bugfix
```

The linked worktree needs no re-stamp: `just crust` resolves the pi-crust package itself through `CRUST_HOME`, then its own stamp pointer, then the pointer beside the shared git directory — found through the clone it was branched from (`references/config.md`, 1.6). The run's data lands in the main clone's `.pi-crust/data`, not the worktree's own, because of the `override:` above.

If you do re-stamp to refresh template-owned documents, use `install.ts --refresh` or `just crust update`. Non-example config files are neither added nor overwritten once `config/` exists; only new `.example.yaml` documents are added there, and existing examples are refreshed. See [install.md](install.md) for the deprecated installer `--force` alias.

```bash
# done with the issue
git worktree remove --force ../pi-crust-issue-42
```

The run is untouched:

```bash
just crust sessions     # the run from the deleted worktree is still listed
just crust observe      # it opens; its working tree is shown as gone, not broken
```

## What a pooled store looks like

```text
~/src/losandes/pi-crust/.pi-crust/data/
├── crust.db                              every tree's runs, one file
├── pi-crust-home                         found by every worktree through .git
├── sessions/
│   └── <run_id>/                         flat; the row carries workspace_root
└── checks/
    ├── pi-crust/<name>.log               just crust verify, run from the main clone
    └── pi-crust-issue-42/<name>.log      the same, run from the (now deleted) worktree
```

`sessions/` stays flat: a worktree's directory name is not stable (`git worktree move` renames it, two clones can share a worktree name), so pooling adds no segment there. `checks/` gains a `<tree>` segment because `runtime/commands/verify.ts` has nowhere else to put two trees' logs that does not collide.

## Pruning a pooled store

```bash
just crust prune 14d                                  # the whole store, every tree
just crust prune 14d --tree /home/dev/pi-crust-issue-42   # one tree only
```

Either form prints which working trees the store holds before it deletes anything. A `--tree` filter also removes that tree's own `checks/` log directory, if one is left — it describes uncommitted state that is gone along with the worktree.

## What this does not do

`just crust merge <tree>` does not exist. If you already have runs scattered across several worktrees created before this was configured, they stay where they are; pooling only takes effect for a worktree created (or a config change made) after `override:` is in place. Consolidating existing data is separate, unbuilt work.

No `.pi-crust` directory is ever symlinked by anything here. See `references/config.md`'s rationale section for why that was considered and rejected.
