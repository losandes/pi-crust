# Centralize a Worktree's Data

Configure the machine once, create worktrees freely, delete them without losing a single run.

## The problem

A configuration using a relative `.pi-crust/data` directory can keep history inside each worktree. Deleting that worktree then removes its history. The package defaults already use `{primary_worktree}` to keep runs in the main clone; the machine settings below make that choice explicit or restore it for older repository configurations.

## Set the machine defaults

The package reads `runtime/config/`, then `~/.pi-crust/config/`, then the repository's single `pi-crust.toml`. Put this in `~/.pi-crust/config/crust.config.toml`:

```toml
# Shared by every repository on this machine.
db = "{primary_worktree}/.pi-crust/data/crust.db"

[defaults]
data_dir = "{primary_worktree}/.pi-crust/data"
```

A repository file that sets either value wins over the machine for that value. Remove or change that repository setting by hand if pooling is intended. There is no forced machine tier. See the [configuration reference](../references/config.md) for precedence and `just crust config` for the effective values.

`{primary_worktree}` expands to `dirname($(git rev-parse --git-common-dir))`, resolved absolute — the main clone a linked worktree was branched from. In the main clone itself it is just the clone. Nothing about the token depends on which repository it is evaluated in, which is why one line in one file covers every clone on the machine, including ones not cloned yet.

## Using it

```bash
# in your main clone, already stamped:
git worktree add ../pi-crust-issue-42 -b issue-42
cd ../pi-crust-issue-42 && just crust run "fix the retry bug" --lifecycle bugfix
```

The linked worktree needs no re-stamp: `just crust` resolves the pi-crust package itself through `CRUST_HOME`, then its own stamp pointer, then the pointer beside the shared git directory — found through the clone it was branched from (`references/config.md`, 1.6). The run's data lands in the main clone's `.pi-crust/data`, not the worktree's own, when neither repository setting overrides the machine values above.

Configuration changes take effect on the next command without re-stamping. `install.ts --refresh` or `just crust update` refreshes template-owned files, never an existing `pi-crust.toml` or execution history. See [install.md](install.md).

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

`just crust merge <tree>` does not exist. If you already have runs scattered across several worktrees created before this was configured, they stay where they are; the configuration changes where later runs write; it does not relocate earlier data. Consolidating existing data is separate, unbuilt work.

No `.pi-crust` directory is symlinked by this setup. The shared data path and package-home pointer keep their existing behavior; no migration of recorded data is performed.
