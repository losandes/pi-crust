# Config Reference

pi-crust reads three TOML layers on every loading command. A repository holds one configuration file, `pi-crust.toml`; installing or updating does not copy the package defaults into it.

## Layers and precedence

From weakest to strongest:

| Layer      | Location                               | Prompt root for entries first declared here |
| ---------- | -------------------------------------- | ------------------------------------------- |
| Package    | `<pi-crust>/runtime/config/`           | `<pi-crust>/runtime/`                       |
| Machine    | `~/.pi-crust/config/`                  | `~/.pi-crust/`                              |
| Repository | `pi-crust.toml` at the repository root | The directory containing that file          |

The package and machine directories each hold `crust.config.toml`, `crust.activities.toml` and `crust.lifecycles.toml`. Missing files contribute nothing. The repository file is optional at the default path; an explicitly selected non-default path must exist. Invalid TOML fails with its filename.

Effective precedence, highest first, is a command-line flag, an existing environment override, repository settings, machine settings, then package defaults. Schema fallbacks supply settings absent from every file. `--config` selects the repository file over `CRUST_CONFIG`; neither selects the package or machine layer. Commands run from the repository root, as the installed justfile does.

| File                    | Accepted top-level keys                          |
| ----------------------- | ------------------------------------------------ |
| `crust.config.toml`     | `defaults`, `db`, `poll_ms`, `ports`             |
| `crust.activities.toml` | `activities`, `planners`, `terminal`             |
| `crust.lifecycles.toml` | `lifecycles`                                     |
| `pi-crust.toml`         | All of the above, plus `tasks` and `task_config` |

Unknown top-level keys are errors naming the file and key. Tasks belong only in the repository file: a task in a package or machine file is an error. Entries are keyed tables; the key is their name and wins over any `name` inside the table.

## Shape

A repository needs only its task declarations and settings that differ from the other layers. The installer writes a comment-only template, which parses to an empty document and declares no tasks.

```toml
# pi-crust.toml
poll_ms = 250

[ports]
backend = 4700
frontend = 4701

[defaults]
model = "anthropic/claude-opus-5"
thinking = "high"

[activities.build]
attempts = 3

[terminal.gh-pull-request]
delivery = { base = "develop", draft = true }

[lifecycles.quick]
description = "Plan and build."
stages = [
  { name = "work", serial = ["plan", "build"] },
]
```

## Defaults merging

Merge the raw documents before applying schema defaults. Tables merge recursively, field by field, with the later layer winning. Arrays and scalars replace whole; lists are never concatenated or merged by index. The same rule applies to every section, including nested `delivery` settings.

For example, the package may declare:

```toml
[activities.build]
purpose = "Implement the plan."
attempts = 2
writes = ["*"]
```

A machine file can set only its model:

```toml
[activities.build]
model = "openai/gpt-6.1-sol"
```

The effective Activity keeps the package purpose, attempt limit and write boundary. An incomplete entry that no earlier layer declares is a new entry, not an ignored patch, and fails validation if it lacks required fields.

A lifecycle's `stages` is an array, so it replaces whole. This machine declaration replaces every shipped stage of `ship`, while keeping its description when none is stated here:

```toml
[lifecycles.ship]
stages = [
  { name = "work", serial = ["plan", "build"] },
  { name = "accept", concurrent = ["outcome-review", "code-review"] },
]
```

After merging, entries inherit `coding_agent`, `model`, `thinking`, `color`, `tools` and `writes` from the merged `defaults` only when they do not state their own. An explicit empty list stays empty.

## Fields

### `defaults`

| Field             | Meaning                                                                                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `coding_agent`    | `"pi"` or `"claude_code"`; only Pi is implemented in v1.                                                                                                                     |
| `model`           | Provider-qualified model pattern. The package ships `"anthropic/claude-haiku-5-5"`.                                                                                          |
| `thinking`        | Provider-specific reasoning-effort string; the package ships `"max"`.                                                                                                        |
| `color`           | Theme role or a literal colour; empty means the UI chooses.                                                                                                                  |
| `tools`           | Tool allowlist inherited by entries without their own. The package ships `["bash", "edit", "read", "write"]`.                                                                |
| `writes`          | Optional inherited write boundary. Entries must have a boundary after inheritance.                                                                                           |
| `protected_files` | Paths governed before a tool call. The package ships `["pi-crust.toml", ".env*", "**/.env*"]`. Arrays replace whole, so a replacement must retain every protection you need. |
| `protected`       | `{ read = "block", write = "block" }` by default. Verbs are `"block"`, `"stop"`, `"warn"`, `"allow"`.                                                                        |
| `ignored`         | The same verbs for Git-ignored paths, excluding session data; default `{ read = "warn", write = "block" }`.                                                                  |
| `data_dir`        | Session runtime home. The package ships `"{primary_worktree}/.pi-crust/data"`.                                                                                               |

### Database, polling and ports

`db` and `poll_ms` are top-level keys, and ports are a `[ports]` table. Set them in any layer: the package or machine `crust.config.toml`, or the repository's `pi-crust.toml`. Loaded callers continue to read `cfg.observability`.

| Key              | Meaning                                                                                                                                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `db`             | Trace database. The package ships `"{primary_worktree}/.pi-crust/data/crust.db"`.                                                                                       |
| `poll_ms`        | Positive integer polling interval in milliseconds, default `500`. The launcher forwards it to the API, and the browser reads it from `GET /api/health` before mounting. |
| `ports.backend`  | API port, default `4600`; a valid `CRUST_BE_PORT` wins.                                                                                                                 |
| `ports.frontend` | Web UI port, default `4601`; a valid `CRUST_FE_PORT` wins.                                                                                                              |

The trace UI still reads theme registrations from an existing `.pi-crust/config/crust.observe.yaml`: only `themes` and `default_theme` are read there. Fresh installs use built-in themes. Theme registration is not part of the TOML loader.

### Activities, Planners and terminal entries

Use `[activities.<name>]`, `[planners.<name>]` or `[terminal.<name>]`. Planners are the closed set `operator` and `triage`; the only terminal Activity is `gh-pull-request`. Every engine entry must be configured, and configuration cannot add a Planner or terminal kind.

| Field                                                 | Meaning                                                                                                                                                                                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `coding_agent`, `model`, `thinking`, `color`, `tools` | Entry-specific settings; absent fields inherit defaults.                                                                                                                                                                                    |
| `purpose`                                             | One sentence describing the work.                                                                                                                                                                                                           |
| `prompts`                                             | One directory, not separate file references; see [Prompts](#prompts).                                                                                                                                                                       |
| `writes`                                              | Required after inheritance. `["*"]` permits repository changes except protected paths; `[]` permits none; a list names exact paths, glob patterns or directory prefixes ending in `/`. `{handoff}` expands to this run's handoff directory. |
| `hidden`                                              | Boolean, default `false`. Removes the entry from interactive selection, not from named execution.                                                                                                                                           |
| `aliases`                                             | Activity-only alternate names, default `[]`. Names and aliases cannot collide with Activities or engine-reserved names.                                                                                                                     |
| `output`                                              | Activity-only published envelope spec, default `"genericOutput"`. Output checks are derived from it.                                                                                                                                        |
| `succession`                                          | Activity-only `"supersedes"` or `"annotates"`. When absent, review outputs annotate and other outputs supersede.                                                                                                                            |
| `input`                                               | Activity-only `"upstream"` or `"changes"`, default `"upstream"`. The latter receives the run's diff since its baseline.                                                                                                                     |
| `attempts`                                            | Activity-only positive integer, default `2`, including the first execution. Gate retries, revisions and regressions share this budget.                                                                                                      |
| `commit`                                              | Activity-only boolean, default `false`. Commit the observed change after verification; `--commit false` can take permission away, never grant it.                                                                                           |
| `delivery`                                            | Terminal-only inline table of optional `remote`, optional `base`, and boolean `draft` defaulting to `false`.                                                                                                                                |

A refused commit leaves work in the tree and records a warning. Delivery retries outstanding commits once and waits rather than pushing when one remains refused. No permission response reverts a developer's working tree.

## Prompts

An entry without `prompts` uses `prompts/<entry name>`. The directory is resolved against the prompt root of the first layer declaring that entry, even when a later layer changes its model or its relative `prompts` string. Package entries therefore keep the package root; machine-only entries use the parent of the machine configuration directory. An absolute directory is used as written.

Read `system.md` and `user.md` from that directory. Both are required for an Activity a run uses; validation stops before a session is minted and names each missing filename, Activity and searched directory. Listing the catalogue does not validate unused prompt files.

A revise round uses `revise.md` when it is a regular file, otherwise `user.md`. The package's `test-tdd` entry sets `prompts = "prompts/test"`; other package entries use their own names. No prompt lookup checks a repository's old override directory. To change shipped prompts for a team, use a package fork; a new machine-only Activity can keep its prompt pair under `~/.pi-crust/prompts/<name>/`.

## Lifecycles and listing order

A `[lifecycles.<name>]` table has optional `description` and a `stages` array. Each stage has a non-empty `name` and exactly one non-empty string list, `serial` or `concurrent`. Both, neither, empty lists and unknown stage keys are load errors naming the lifecycle and stage. Array-of-table TOML notation is also accepted.

Stages execute in array order. A serial Stage executes its Activities in list order; a concurrent Stage starts them together. Concurrent writes must be disjoint, and judging Activities cannot share a Stage with writers. Duplicate stage names, repeated Activities in one Stage and misplaced engine steps are refused by lifecycle validation.

Activities, Planners, terminal entries and lifecycles are listed by the first layer declaring each name: package first, then machine, then repository; names within each group sort by UTF-16 code-unit comparison. Parser table order and locale do not decide this order. A patch retains its entry's original group. `hidden = true` affects selection only; `just crust list` still names the entry. Aliases resolve before planning and traces retain canonical names. Use the interactive reorder screen for a different execution order on one run.

### The engine step `import`

`import` is not an Activity, alias, model or prompt. It may appear only first in a serial first Stage. The engine imports the issue or markdown document the request references before any agent starts. See [Importing referenced work](handoff.md#importing-referenced-work).

## Output checks

Output checks follow from the published envelope spec named by `output`; they are engine-owned, not per-entry gate lists.

| Report            | Checks                                                    |
| ----------------- | --------------------------------------------------------- |
| Any Activity      | `artifactsExist`, `filesNonEmpty`, `jsonParses`           |
| `reviewOutput`    | Also `verdictConsistent`                                  |
| `ghIssueOutput`   | Also `issueCreated`                                       |
| `diagnosisOutput` | Also `reproductionSupported`                              |
| `buildOutput`     | Also `diffMatchesClaims`                                  |
| Planner           | Artifact checks and `stepsValid`                          |
| Revise round      | Artifact checks, the spec's check and `disputesSupported` |
| Terminal delivery | Artifact checks, then `pull_request_opened`               |

`routing`, per-entry `gates` and a forced `override` section are refused with all removed-setting faults reported together. Repository tasks run independently of output checks, including on revise rounds.

## Delivery

```toml
[terminal.gh-pull-request]
delivery = { draft = false }
```

A terminal Activity may appear only last in the last Stage, never in a concurrent Stage. It runs once after the chain and its review loop settle.

Delivery settings merge field by field. No shipped default configures a remote or base branch. Remote selection is:

1. `delivery.remote`, when configured.
2. Git's non-empty `remote.pushDefault`.
3. The sole configured remote, when exactly one exists.
4. `origin`.

A missing chosen remote is refused by name. The harness performs Git and GitHub operations; the agent drafts the title and body with read-only tools. The harness supplies the recorded Activities and Checks sections, and can fall back to a trace-generated body when drafting fails.

### The base branch

Base-branch selection is unchanged:

1. An explicit `--scope` flag (`--base` is an alias); a written range endpoint is explicit. Delivery has no flag tier.
2. `delivery.base` on `gh-pull-request`.
3. The chosen remote's locally recorded default branch, from `refs/remotes/<remote>/HEAD`.
4. `main`.

This lookup does not contact a remote or repair refs. A run's recorded starting commit precedes these tiers for change measurement. Delivery refuses to push from the base branch and does not create a source branch for you. An outstanding refused commit, failed authentication or failed push waits for repair and resume rather than silently delivering. A terminal Lifecycle requiring commits refuses `--commit false` before startup.

## Environment variables and provenance

| Variable                         | Meaning                                                                                                                                            |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CRUST_CONFIG`                   | Repository TOML file; `--config` wins. Default `pi-crust.toml`.                                                                                    |
| `CRUST_PACKAGE_CONFIG`           | Directory containing the package layer's three files; normally `runtime/config/`, derived from the loader's location.                              |
| `CRUST_MACHINE_CONFIG`           | Directory containing the machine layer's three files; normally `~/.pi-crust/config/`. It no longer names one file.                                 |
| `CRUST_DATA_DIR`                 | Overrides `defaults.data_dir`.                                                                                                                     |
| `CRUST_DB`                       | Overrides the database path; a supported `--db` flag wins. Does not move session directories.                                                      |
| `CRUST_BE_PORT`, `CRUST_FE_PORT` | Valid positive port numbers override configured ports. Invalid values leave the configured value in force.                                         |
| `CRUST_POLL_MS`                  | Launcher-to-server channel, not a user override. The launcher replaces any existing value with the loaded polling interval.                        |
| `CRUST_HOME`                     | Package-home override; otherwise recipes use the recorded `.pi-crust/data/pi-crust-home`, including the main clone's pointer for linked worktrees. |
| `CRUST_REGISTRY`                 | Machine-local workspace registry location; see [Observability](observability.md).                                                                  |

Blank directory and path overrides read as unset. The machine home is `HOME` when present, otherwise the operating-system home directory.

`just crust config` reports defaults, database, polling, ports, entry models/thinking/prompt directories, terminal delivery fields and lifecycle stage names. Each value names its repository, machine or shipped-default file, or its environment override. Inherited model and thinking fields identify the corresponding default as their source. Unset values display `(not set)`.

### The `{primary_worktree}` token

The package preserves history locations: `defaults.data_dir = "{primary_worktree}/.pi-crust/data"` and `db = "{primary_worktree}/.pi-crust/data/crust.db"`. The token resolves per repository to its main clone, including from linked worktrees. Without Git it falls back to the repository root; a bare repository is refused rather than writing beside it. Leading `~` expands to the user's home; absolute paths remain absolute and relative paths resolve from the repository root.

`CRUST_DB` changes only the store. To locate another repository's session files as well, also set `CRUST_DATA_DIR`. Session and handoff paths, workspace registration and the package-home pointer otherwise keep their behavior. See [Centralize a Worktree's Data](../cookbooks/centralize_worktree_data.md).

## Thinking levels

Pi's reasoning-effort ladder, lowest to highest:

```text
off | minimal | low | medium | high | xhigh | max
```

Mapped to Pi's reasoning effort control and honored when the model is registered with `reasoning: true` in `~/.pi/agent/models.json`. On a non-reasoning model the setting is inert — no error, no effect. Rough guidance: `high`/`xhigh` for planners and reviewers, `medium` for builders, `low` for mechanical read-and-report agents. (For Claude Code in v2, the same field maps to the thinking budget.)

## Model resolution

**Always write `model` as `provider/model-id`.** `execute-agent.ts` hands the string to the Pi interface, which resolves it against pi's merged catalog — `~/.pi/agent/models.json` plus pi's built-in providers. The same model is usually carried by more than one provider (`gemini-3.6-flash` lives under `google` *and* under `openrouter` as `google/gemini-3.6-flash`), and a bare id that matches several **raises at resolution**:

```text
agent 'scout': model pattern 'gemini-3.6-flash' is ambiguous:
  [('google', 'gemini-3.6-flash'), ('openrouter', 'google/gemini-3.6-flash'), ...]
```

That is `validateAgents()` doing its job — it fails before anything spawns rather than silently billing the wrong provider — but it means every agent in the roster inheriting that default is grounded until the pattern is qualified. Qualifying is the whole fix: `google/gemini-3.6-flash`, `openai/gpt-5.6-terra`, `fireworks/accounts/fireworks/models/kimi-k3`. The leading segment is matched against the provider list first, so the rest of the string can contain slashes.

Other consequences worth knowing:

- A model must be in the catalog before any agent can name it. An unknown id fails at resolution, before spawn. `pi --list-models` is the catalog the resolver actually reads.
- **Ambiguity can appear without you touching the config.** Registering a new provider that carries a model you already use turns a formerly-fine bare pattern ambiguous. If a roster stops validating and nobody edited it, that is why.
- Provider credentials come from the environment, not the config — the key that matches the provider you named (`GEMINI_API_KEY` for `google/...`, `OPENROUTER_API_KEY` for `openrouter/...`).
- The resolved model is recorded per session in `agent_map.json` and mirrored into the `agent_sessions` table. **Changing an agent's model invalidates its session**: a joined run starts that agent fresh instead of resuming a context window built by a different model.

## Tools

`tools` maps to `pi --tools`. Pi's seven builtin tool names:

| Tool    | Purpose                 | Pi's own default |
| ------- | ----------------------- | ---------------- |
| `read`  | read file contents      | on               |
| `bash`  | execute bash commands   | on               |
| `edit`  | find/replace edits      | on               |
| `write` | create/overwrite files  | on               |
| `grep`  | search file contents    | **off**          |
| `find`  | find files by glob      | **off**          |
| `ls`    | list directory contents | **off**          |

`grep`, `find`, and `ls` are off in bare Pi, so an agent that does not name them will shell out through `bash` to do the same work. The package sets `defaults.tools` to `read`, `bash`, `edit` and `write`; an entry may replace that list.

**Resolution order:** an agent's own `tools` list wins; an agent that omits the key inherits `defaults.tools`; if neither is set, `tools` stays `undefined` and all tools are usable. An empty list is not "all tools" — it is a tool-less agent, and it will stall.

## Write permissions

Tool lists are capabilities, not filesystem boundaries: `bash` can run arbitrary commands. The package path-policy extension governs protected and Git-ignored paths before a tool call. Its structured read, edit and write checks are precise; shell-command inspection is best-effort. Withhold `bash` when strict path isolation is required.

`writes` is checked against observed changes after execution. Oversteps and unreported changes are named in the terminal, trace and visualizer, never reverted: a developer can edit the same working tree while an Activity runs. Commits include only the Activity’s observed paths, not unrelated developer work.

Session runtime and the handoff directory remain writable so every Activity can record its own result. Name handoff documents with `{handoff}`, not a particular run ID. The same declaration supplies the rendered `{{output_document}}` path.

```toml
[activities.reviewer]
writes = ["{handoff}/review.md"]
```

## Stopping the run for a person

`--approve-after` takes Activity names, and Stage names prefixed with `stage:`:

```bash
just crust run "..." --lifecycle sdlc --approve-after plan,stage:accept
```

| Named          | Stage strategy | The run pauses                              |
| -------------- | -------------- | ------------------------------------------- |
| an Activity    | serial         | as soon as that Activity completes          |
| an Activity    | concurrent     | after every Activity in the Stage completes |
| `stage:<name>` | either         | after every Activity in the Stage completes |

An Activity gate inside a concurrent Stage cannot stop its siblings — they are already running, and an agent killed mid-write leaves the tree in a state nobody declared. The gate is recorded when the Activity finishes and enforced at the Stage boundary, naming the Activity that raised it.

The prefix exists because Activities and Stages share a namespace. A bare `accept` would be ambiguous the first time somebody names a Stage after an Activity it contains.

## Extensions

Every agent loads only the path policy shipped in `runtime/extensions/path-policy.ts`. Its path is resolved from the package, not from repository overrides or configuration. Configuration cannot load additional extensions.

## Tasks

Declare commands under `[tasks.<name>]` in the repository’s `pi-crust.toml`; tasks are accepted nowhere else. Tasks fire at four triggers: `on = "change"` after the current Unit's Activities finish and their output checks are judged, before acceptance or commit; `on = "deliver"` after the chain settles, before delivery or final success; `before = "<activity>"` before any Activity of the containing stage starts; and `after = "<activity>"` after every Activity in that stage settles. The same triggers apply to named Lifecycles and chains composed on the command line. Disabling commits does not disable tasks. `just crust verify` evaluates only `on = "change"` triggers over the working tree or an explicit `--scope`, without starting an agent or recording a run.

```toml
[task_config]
timeout_seconds = 300

[tasks.lint]
when = [{ on = "change" }]
match = ["**/*.ts", "**/*.tsx"]
run = "<your lint command> {{changed_paths}}"

[tasks.test]
when = [{ on = "change", skip = ["diagnose", "test-tdd"] }]
match = ["packages/api/**/*.ts"]
cwd = "packages/api"
run = [
  "<your test command> {{changed_paths}} | <your reporter>",
  "<your coverage command> {{base_ref}}",
]
timeout_seconds = 600

[tasks.verify-all]
when = [{ on = "deliver", skip = ["diagnose", "test-tdd"] }]
run = "<your full verification command>"

[tasks.schema]
when = [{ before = "code-review" }, { after = "build" }]
match = ["db/**"]
run = "<your schema check> {{changed_paths}}"
```

- `task_config.timeout_seconds`: positive integer, default `300` seconds per command.
- `tasks`: a map, empty by default. Names start with an ASCII letter and can then include ASCII letters, digits, `_`, `.`, `:` and `-`. Tasks run in declaration order in that one repository file.
- `when`: a required non-empty list, with no duplicate trigger: each `on` moment once and each `before` or `after` name once. An entry has exactly one of `on`, `before`, or `after`. Only `on` accepts `skip`, which defaults to `[]`. At `change`, `skip` excludes a skipped Activity's paths. At `deliver`, it suppresses the task only when the last Activity to change repository files is skipped, and the run records the skipped task and Activity. Names are canonicalized, including aliases and numbered instances. Unknown skip names are ignored. `verify` ignores `skip` because no Activity produced the change.
- `match`: Git-root-relative globs over changed paths that still exist. `*` does not cross `/`; `**` does. An omitted or empty list matches every existing changed path. A task with no selected paths does not run.
- `cwd`: a directory relative to the Git root, with no `..` segment. An omitted or empty value runs at the root. Selected paths are made relative to this directory before substitution.
- `run`: a non-empty shell string or non-empty list of non-empty shell strings. The task runs every command in order, even when one fails.
- `timeout_seconds`: positive integer overriding `task_config.timeout_seconds` for each command in this task.

Use `{{changed_paths}}` and `{{base_ref}}` as their own words, outside quotes, where `sh` reads arguments. Optional whitespace inside the braces is allowed. `{{changed_paths}}` expands to one argument per distinct selected path, sorted before respelling for `cwd`. `{{base_ref}}` expands to one argument: the run's starting commit, or for `verify` the selected base or `HEAD`. If no commit resolves, it is an empty argument. Other brace text is left unchanged. Empty values expand to `''`; values made up solely of ASCII letters, digits or `_@%+=:,./-` are unchanged. Other values are single-quoted, with each embedded single quote rendered as `'\''`. Variables detected inside quotes are refused at load. Every other placement is unsupported, including joining a variable to other text, even if it happens to work for a commit ID.

Commands run as `sh -c` with the operator's environment and no added shell options. Exit status zero passes. On timeout the runner sends `SIGTERM` to the command's process group, then sends `SIGKILL` at command close or after at most ten seconds and reports exit `124`. Full stdout and stderr are saved with the command's status and duration; feedback includes the output tail.

After a concurrent stage, a task runs once per settlement round over the union of the paths it selected. A failed task and any failed output checks are combined as feedback for each affected Activity; only Activities with violations spend another attempt. An exhausted Activity stops the run. Resuming evaluates replayed Activities' tasks again over all their recorded paths in the run, including earlier attempts. Existing changed paths no task selected are counted in the run summary without failing the run. When no tasks are declared, the run reports that no commands ran.

At `before` and `deliver`, selection covers every repository path observed to change during the run, excluding session and handoff files and paths that no longer exist. A run with no repository-writing Activity runs no whole-change tasks. A failure returns to the last writer with the task output as private feedback, spends one of that instance's attempts, and reruns everything after it. A nested revision is routed to its chain writer at that review boundary. Missing destinations or exhausted attempts end the run failed with the task named and do not deliver. A failing `before` never starts its stage: if the last writer is in that stage or later after a regression, the run blocks rather than returning into it. Older traces without chain-run provenance also block when a failure cannot be routed.

At `after`, only Activities whose paths the failed task selected run again, with their own Unit's entry context and task feedback. Unselected siblings do not rerun. Each retry must pass its output checks and `change` tasks before `after` is evaluated again. Both `before` and `after` match canonical Activity names or aliases and Planner names; undefined names fail configuration loading with the task, missing name, defined Activities and definition-file locations. Terminal Activities run outside stages and cannot be named by these triggers; use `on = "deliver"` instead. Neither trigger fires inside the revise loop's nested folds.

Resuming re-evaluates `deliver`; no persisted pass permits delivery without verification. `before` does not judge a stage entered entirely by replay, while `after` still evaluates its recorded paths. After a person accepts a previously rejected run, a failing `deliver` ends the run failed rather than returning automatically; repair the failure and resume again. A refused commit remains a warning retried at delivery, never task feedback, and uncommitted observed work is still verified.

## Agent colours are theme roles

`color` names a role from the theme palette, not a hex:

```text
blue  amber  green  purple  cyan  pink  violet  orange  teal  indigo  rose  lime
```

Each theme decides what a role looks like — `amber` is `232 182 74` on dark and `150 100 10` on light, because the second has to be legible on white. The visualizer resolves a role to `rgb(var(--amber-rgb))` at render, so switching theme re-colours every lane, including lanes in runs recorded months earlier. That works because the trace stores the role it was given rather than a finished colour.

`red` is deliberately not offered. It means a failed activity run everywhere else in the interface, and an agent permanently wearing the failure colour reads as broken at a glance.

A hex still works and is honoured verbatim. It is the escape hatch for a colour the palette does not have, and it is theme-unaware by definition: it will be whatever you wrote on every theme, and its contrast is yours to own rather than the theme's.

An agent that names nothing takes a role by position, so adjacent lanes in a waterfall always differ. Twelve roles cover a roster of eighteen agents, which means two agents far apart in the list can share — distinguishable in practice, because what matters is the lanes on screen together.

## The trust dial has four behaviours, so it has four names

```text
none    every question stops the run, trivial ones included
low     every consequential question stops it
medium  it decides what it can defend and reports it; a question it could not
        answer, or an action reaching beyond this run, stops it
high    nothing stops it unless you asked with --approve-after
```

The axis is the run's blast radius, not the importance of the subject. Two things stop a medium run and only two: an empty `provisional_answer`, which means the stage had no answer it could defend and proceeding would be invention; and `beyond_this_run: true`, which means acting would reach outside what discarding the run's output would undo — a push, a deploy, a migration against real data, spend.

It used to be irreversibility, and that was wrong in a way worth recording. An agent correctly calls a schema irreversible, so a run that was only writing a *document* about a schema stopped at nearly every Activity. Measured across every question the factory has written, 12 of 40 carried both flags, and they were questions like "which naming survives" and "is that year 2026 or 2025" — things a colleague decides, states, and is corrected on later.

Each level is now rendered into every agent's prompt as `{{trust_stance}}`. Before, no prompt mentioned the dial at all: it filtered the agent's classification after the fact, so raising it could not make an agent try harder to settle anything. A setting the worker cannot see is a report filter, not a setting.

`--trust-level medium` and `CRUST_TRUST_LEVEL=high` are the way to say it. Numbers still work, because the trace, the flag and the config have recorded them from the start — but there are exactly three thresholds, so 60, 80 and 50 are the same run. A number between thresholds now says which band it landed in: `trust 80 behaves as medium (50)`. Accepting a precision the dial does not honour and then printing the number back is how somebody believes they tuned something.

`just crust please` offers three: low, medium, high. `none` is a debugging setting rather than a way to work, and offering it in a menu invites somebody to pick it once and conclude the whole thing is unusable. It is still there on the flag.

The default is medium, set by `TRUST_DEFAULT`; use the flag or `CRUST_TRUST_LEVEL` for a different trust level.

## Configuration that is no longer read

There is no dual-format support and no conversion command. Migrate by hand; installing again leaves the old configuration and prompt directories untouched. Preserve `.pi-crust/data/`, which contains execution history and the package-home pointer.

| Old location or shape                                 | Status and hand migration                                                                                                                                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.pi-crust/config/crust.config.yaml` or `.yml`        | Not read. Move defaults into `[defaults]` and tasks into `[tasks.<name>]` in `pi-crust.toml`.                                                                                                                 |
| `.pi-crust/config/crust.activities.yaml`              | Not read. Convert each list entry into `[activities.<name>]`, `[planners.<name>]` or `[terminal.<name>]` in the appropriate TOML layer. Usually keep only repository-specific differences in `pi-crust.toml`. |
| `.pi-crust/config/crust.lifecycles.yaml`              | Not read. Convert entries into `[lifecycles.<name>]`, using `serial` or `concurrent` on each stage.                                                                                                           |
| `.pi-crust/config/crust.observe.yaml`                 | The TOML loader does not read it. The trace UI still reads `themes` and `default_theme` there; move `db`, `poll_ms` and `[ports]` into a supported TOML layer.                                                |
| Any `.local.yaml`, `.local.yml` or `.local.toml` file | Not read. Put personal preferences in the corresponding file under `~/.pi-crust/config/`. There is no private repository layer.                                                                               |
| `~/.pi-crust/config/crust.config.yaml` or `.yml`      | Not read. Split its settings among the three TOML files under `~/.pi-crust/config/`.                                                                                                                          |
| `CRUST_MACHINE_CONFIG` naming one file                | Not read; a notice names the variable and file. Set it to the directory holding the three TOML files.                                                                                                         |
| `override:`                                           | Removed. Put its settings at the top level of the same TOML file. The repository now always wins over the machine for the same setting.                                                                       |
| `prompts = { system, user, revise }`                  | Not accepted. Use one directory holding `system.md`, `user.md` and optional `revise.md`.                                                                                                                      |
| `.pi-crust/prompts/`                                  | Not read. Shipped entries use their first-declaring layer's root, not repository prompt lookup. Change package prompts in a fork, or define a new machine Activity with prompts under `~/.pi-crust/prompts/`. |

A loading command that finds legacy repository YAML files announces the directory and filenames and says they are not read. It also announces an old machine YAML file or a file-valued `CRUST_MACHINE_CONFIG`. An ignored old file never contributes settings. Unsupported keys in an active TOML file are load errors rather than silent overrides.

## Examples

The files under `cookbooks/examples/` are documentation, not automatically loaded configuration. Copy or merge only the settings you want:

| Example                                 | Destination                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------ |
| `crust.config.machine.example.toml`     | `~/.pi-crust/config/crust.config.toml`                                         |
| `crust.activities.machine.example.toml` | `~/.pi-crust/config/crust.activities.toml`                                     |
| `crust.lifecycles.machine.example.toml` | `~/.pi-crust/config/crust.lifecycles.toml`                                     |
| `crust.activities.bic.example.toml`     | Model and thinking assignments for `~/.pi-crust/config/crust.activities.toml`  |
| `crust.activities.econ.example.toml`    | Economy model and thinking assignments for the same machine file               |
| `pi-crust.example.toml`                 | `pi-crust.toml`, with repository commands substituted for the example commands |

Package defaults are read live from `runtime/config/`. Changing the installed package updates the next command without re-stamping a repository; the installer never replaces an existing `pi-crust.toml`, even with its refresh or force flag.
