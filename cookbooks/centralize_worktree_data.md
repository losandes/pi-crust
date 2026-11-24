# Choose Where Run Data Lives

The default is one machine-wide trace at `~/.pi-crust/data/crust.db`, with every run's directory under `~/.pi-crust/data/sessions/`. Runs from unrelated repositories and linked worktrees are visible together. Removing a worktree does not remove its trace.

## Keep one repository's data inside it

Set this in that repository's `pi-crust.toml`:

```toml
[defaults]
data_dir = "{primary_worktree}/.pi-crust/data"
```

`{primary_worktree}` resolves to the main clone, including when invoked from a linked worktree. The database is always `crust.db` inside this directory, alongside `sessions/`. A repository setting wins over the machine and package layers. `CRUST_DATA_DIR` is a one-command override of the same location.

A linked worktree needs no setup of its own: `crust` is on the PATH and runs the same package from every working tree.

## Existing history

Changing the data directory affects later runs only. Earlier databases and session directories are neither moved nor merged, and old per-repository pointers are not consulted or deleted. To view an earlier repository trace explicitly:

```bash
CRUST_DATA_DIR=<repo>/.pi-crust/data crust observe
```

`crust prune 14d` describes eligible runs across the selected store; add `--tree <working-tree>` to narrow it and `--yes` only after reviewing the dry run. Never delete a data directory as part of a configuration update.
