# Create a Lifecycle

A lifecycle is TOML configuration, not code. Define it in `~/.pi-crust/config/crust.lifecycles.toml` for every repository on this machine, or in a repository's single `pi-crust.toml` for that repository. Package lifecycles live in `<pi-crust>/runtime/config/crust.lifecycles.toml`. The three layers merge in that order, with the repository winning.

## Choose Activities

Use `crust list` to inspect the merged catalogue. A lifecycle names Activities the registry defines; it does not define agents, models or prompts. Add a missing Activity first using [Update Config](update_config.md).

## Declare ordered stages

```toml
[lifecycles.quick]
description = "Plan, build and review."
stages = [
  { name = "work", serial = ["plan", "build"] },
  { name = "accept", concurrent = ["outcome-review", "code-review"] },
]
```

The table key names the lifecycle. Stages execute in array order. Each stage has a non-empty name and exactly one non-empty `serial` or `concurrent` list. Neither key defaults implicitly; both, neither, an empty list or an unknown stage key stops configuration loading and names the lifecycle and stage.

A serial Stage is a sequence: dependent Activities run one after another in the listed order. Group them where they form one progression step rather than creating one Stage per Activity. There is no `depends_on`; a Stage follows the one before it.

## Claim concurrency only where true

Concurrent Activities share one working tree. Their declared `writes` must be disjoint, and a judging Activity cannot share a Stage with a writer. An Activity with `["*"]` overlaps everything. The mechanical checks cannot establish that two disjoint writers are logically independent: choose concurrency only when neither needs the other's unfinished work.

## Verify the declaration

Run `crust list` or open `crust please`. The lifecycle is offered automatically. Entries are grouped by first-declaring layer, package then machine then repository, with names sorted inside each group; rearranging TOML tables does not reorder the menu.

```bash
crust run "the request" --lifecycle quick
```

Starting a run executes agents. Listing the declaration does not.

A Stage is addressable with `--approve-after stage:accept`. Inside a concurrent Stage, an Activity approval point waits for its siblings before stopping. Stage names must be unique within a lifecycle, and one Stage cannot name the same Activity twice.

A later layer can replace a description without replacing stages, but any `stages` list replaces the earlier list whole. See [Update a Lifecycle](update_lifecycle.md), and [Importing referenced work](../references/handoff.md#importing-referenced-work) for the engine-only `import` step.
