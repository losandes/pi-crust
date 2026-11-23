# Update Config

Choose the layer whose scope matches the change. Package defaults live in `<pi-crust>/runtime/config/`; machine preferences live in `~/.pi-crust/config/`; the repository holds one `pi-crust.toml`. Later layers win field by field, and arrays replace whole. An update to the package is read by the next command without re-stamping.

## Retune model, thinking or colour

For every repository on this machine, edit `~/.pi-crust/config/crust.activities.toml`:

```toml
[activities.build]
model = "openai/gpt-6.1-sol"
thinking = "high"
color = "cyan"
```

For one repository, put the same table in `pi-crust.toml`. Its value wins over the machine. `just crust config` shows the effective model, thinking level and source.

Write models as `provider/model-id`, not ambiguous bare IDs. Validate the provider catalogue with `pi --list-models`. Changing a model in a joined run starts that agent with a fresh session; thinking or colour changes do not invalidate its model-bound session. Colour names are theme roles; the UI can fall back when no colour is configured.

## Defaults and tools

Machine-wide defaults belong in `~/.pi-crust/config/crust.config.toml`:

```toml
[defaults]
model = "anthropic/claude-opus-5"
thinking = "high"
tools = ["read", "bash", "edit", "write", "grep", "find", "ls"]
```

An entry naming no value inherits the merged default. To replace one entry's tools, use its table in the machine activities file or repository TOML:

```toml
[activities.outcome-review]
tools = ["read", "grep", "find", "ls", "bash", "write"]
```

The list is the complete allowlist, not an addition. An empty list means no tools. Any Activity producing a handoff document needs a way to write it. Tool lists do not replace `writes` boundaries or the package path policy; configuration cannot add extensions or replace that policy.

## Add a machine-only Activity

Create `~/.pi-crust/prompts/spike/system.md` and `user.md`; add optional `revise.md` when revisions need a different template. Then add this to `~/.pi-crust/config/crust.activities.toml`:

```toml
[activities.spike]
purpose = "Answer one throwaway question without touching the repository."
output = "researchOutput"
writes = ["{handoff}/spike.md"]
```

It defaults to `prompts/spike` relative to `~/.pi-crust/`. The Activity is available in every repository on this machine, without editing those repositories. Both required files are checked before a run uses it; a missing file does not prevent listing.

An Activity may share a directory with `prompts = "prompts/<other-name>"`. The directory's root is the layer that first declares the entry, even if a later layer tunes its fields. Shipped entries therefore retain the package root. For team changes to shipped prompts, use a package fork. Repository prompt override lookup is removed.

Name the Activity for its work, supply a write boundary and choose a published `output`; the engine derives [output checks](../references/config.md#output-checks). No code registry needs editing. To add package-wide behavior, edit the package's activity table and prompt directory instead. A new entry has no existing fields to inherit except defaults, so a typo in an entry name can fail required-field validation rather than silently do nothing.

## Planners, delivery and repository tasks

Tune `operator` or `triage` under `[planners.<name>]`; configuration cannot add or remove Planners. Tune delivery under `[terminal.gh-pull-request]`, for example `delivery = { draft = true }`. Leave `remote` and `base` absent unless discovery selects the wrong values; see [Delivery](../references/config.md#delivery).

Tasks are repository-specific. Declare them only under `[tasks.<name>]` and `[task_config]` in `pi-crust.toml`. Lifecycles use `[lifecycles.<name>]`; see [Create a Lifecycle](create_lifecycle.md). Lists are ordered by first-declaring layer and name, not by table order in a file.
