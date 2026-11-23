# Create Config

Generate the repository's `pi-crust.toml`:

```bash
bun <pi-crust>/scripts/make-config.ts
```

Run from the target repository root. The command copies the comment-only template, with inactive example tasks and no runnable commands. It refuses an existing file unless explicitly given `--force`. Preserve existing settings before using that option. The installer never replaces an existing repository TOML file, even with its refresh flag.

## The three layers

The package's `<pi-crust>/runtime/config/` supplies defaults. The machine's `~/.pi-crust/config/` supplies preferences shared by every repository. The repository's `pi-crust.toml` wins over both for fields it states. Nothing needs re-stamping after a package or machine edit.

Package and machine directories each accept `crust.config.toml`, `crust.activities.toml` and `crust.lifecycles.toml`. Tasks and `[task_config]` belong only in `pi-crust.toml`. Tables merge recursively; arrays replace whole.

## Declare repository commands

Uncomment a template task and substitute the repository's real command:

```toml
[task_config]
timeout_seconds = 300

[tasks.lint]
when = [{ on = "change", skip = ["diagnose", "test-tdd"] }]
match = ["**/*.ts", "**/*.tsx"]
run = "<your lint command> {{changed_paths}}"
```

The command shown is a placeholder, not a working verification command. Keep it commented out until replaced. The [Tasks reference](../references/config.md#tasks) defines triggers, skip behavior, path selection and timeout semantics.

## Tune only differences

```toml
[defaults]
model = "anthropic/claude-opus-5"
thinking = "high"

[activities.build]
attempts = 3

[terminal.gh-pull-request]
delivery = { base = "develop" }
```

Put machine-wide preferences in the corresponding machine file instead of repeating them across repositories. A partial table retains every field earlier layers supplied; an unknown name creates a new entry and must provide all required fields after inheritance.

## Prompts and validation

Each entry names one optional directory with `prompts = "prompts/<name>"`, defaulting to its own name. `system.md` and `user.md` are required when that Activity runs; `revise.md` is optional. Relative directories resolve against the first-declaring layer's root, not the later file that merely tunes an entry. A machine-only Activity normally keeps its prompt pair under `~/.pi-crust/prompts/<name>/`. Change shipped prompt behavior in a package fork, not a repository override.

Use `just crust list` to inspect the catalogue and `just crust config` for effective values and their sources. Listing permits an unused Activity with missing prompts; run startup checks the prompt files of the Activities actually selected.

Full field definitions, file-to-key routing, precedence and hand migration are in the [configuration reference](../references/config.md). To add an Activity, follow [Update Config](update_config.md).
