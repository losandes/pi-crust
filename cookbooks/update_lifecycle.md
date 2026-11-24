# Update a Lifecycle

Edit the lifecycle's keyed TOML table. The package reads `<pi-crust>/runtime/config/crust.lifecycles.toml`, then `~/.pi-crust/config/crust.lifecycles.toml`, then the repository's single `pi-crust.toml`. Each later layer wins field by field. Changes are read on the next command without installing again; the installer never overwrites an existing repository TOML file.

## Replace a stage list

A lifecycle's `stages` is one ordered array. Naming it in a later layer replaces the earlier array whole; no Stage is merged by name or index. Restate every Stage you want retained:

```toml
[lifecycles.quick]
stages = [
  { name = "implement", serial = ["test", "build"] },
  { name = "accept", concurrent = ["outcome-review", "code-review"] },
]
```

Its earlier description survives when not stated here. To change only the description, set just `description` in the table.

## Add or move Activities

Position inside a `serial` list is execution order. Stages run in array order, so moving a Stage changes the progression. A lifecycle names existing Activities, never a Planner. Inspect the merged catalogue with `crust list` before selecting names.

To make a Stage serial again, replace `concurrent = [...]` with `serial = [...]`. Do not delete the strategy key: exactly one is required. To split a Stage, replace its entry with two named entries at the same position:

```toml
[lifecycles.quick]
stages = [
  { name = "prepare", serial = ["test"] },
  { name = "deliver", serial = ["build"] },
]
```

Splitting a serial chain preserves its Activity order but creates another addressable boundary for `--approve-after stage:<name>`.

## Machine preferences

Set a lifecycle table in `~/.pi-crust/config/crust.lifecycles.toml` to use it across repositories. A repository's `pi-crust.toml` still wins for fields it states. The machine examples are in `<pi-crust>/cookbooks/examples/`; merge them by hand if the destination already exists.

## What is refused

| Declaration                                                                       | Reason                                                                     |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Both `serial` and `concurrent`, neither, an empty list or unknown stage keys      | A stage needs one unambiguous execution strategy and non-empty Activities. |
| Duplicate Stage names                                                             | An approval point could not identify one Stage.                            |
| One Activity repeated within a Stage                                              | It would race itself under concurrency.                                    |
| Concurrent overlapping writes                                                     | The Activities can overwrite each other's work.                            |
| Judging and writing Activities sharing a concurrent Stage                         | The judge would read unfinished work.                                      |
| `import` anywhere but first in a serial first Stage                               | Referenced work is imported before Activities run.                         |
| A terminal Activity anywhere but last in the last Stage, or in a concurrent Stage | Delivery runs after the rest of the chain settles.                         |

For `import`, follow [Importing referenced work](../references/handoff.md#importing-referenced-work). Check the merged result with `crust list` and the effective stage names with `crust config`; starting a run additionally validates the prompt files it uses.
