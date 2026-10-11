# Config Reference

The full `crust.config.yaml` spec: every field, how defaults merge, and how model / thinking / tools / extensions map onto the coding agent.

It lives at **`.pi-crust/config/crust.config.yaml`** — the default path every `stages/*.ts` or `lifecycles/*.ts` and the justfile resolve, and where `install.ts` / `make-config.ts` stamp it. Pass `--config <path>` to any workflow, or set `CRUST_CONFIG`, to run against a different roster. The flag wins over the variable, and an empty variable reads as unset. `CRUST_DB` overrides the trace database the same way for `report.ts`, which is how the reporter is pointed at another repository's run. `CRUST_REGISTRY` moves the machine-local list of working trees that have run the factory — see the observability reference for what reads it. `CRUST_HOME` says where pi-crust itself is installed, which the `observe` recipe needs because the web app ships with the package rather than with the stamp; the installer records it in `.pi-crust/data/pi-crust-home` and the variable overrides that, for when the package moves.

## Shape

```yaml
defaults:
  coding_agent: pi
  model: google/gemini-3.6-flash        # ALWAYS provider/model-id
  thinking: medium
  harness_engineering: []
  tools: [read, bash, edit, write, grep, find, ls]
  data_dir: .pi-crust/data

activities:
  - name: planner
    coding_agent: pi
    model: google/gemini-3.6-flash        # ALWAYS provider/model-id
    thinking: high
    color: "#a78bfa"
    purpose: Turn a request into a plan the builder can implement without asking questions.
    prompt_engineering:
      system: <pi-crust>/runtime/prompt-engineering/planner/system.md
      user: <pi-crust>/runtime/prompt-engineering/planner/user.md
    harness_engineering:
      - json-enforcer
    tools:
      - read
      - bash
```

## Fields

### `defaults`

| Field                 | Type                  | Meaning                                                                                                                                                                                                                                                                                     |
| --------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `coding_agent`        | `pi` \| `claude_code` | Which interface runs the agent. **v1 implements `pi` only**; `claude_code` is specced and stubbed in `data/claude-code-agent.ts`, landing in v2.                                                                                                                                            |
| `model`               | string                | Model id. For Pi, any id registered in `~/.pi/agent/models.json`. Default `gemini-3.6-flash`.                                                                                                                                                                                               |
| `thinking`            | enum                  | Reasoning effort — see below. Default `medium`.                                                                                                                                                                                                                                             |
| `color`               | hex string            | Lane color for every agent that does not set its own. Default empty — the visualizer falls back to its own palette.                                                                                                                                                                         |
| `harness_engineering` | list[string]          | Coding-agent extensions. Pi: extension names. Claude Code: reserved (MCP, hooks).                                                                                                                                                                                                           |
| `tools`               | list[string]          | Roster-wide tool allowlist. Every agent that omits its own `tools` inherits this. Unset = all tools usable.                                                                                                                                                                                 |
| `protected_files`     | list[string]          | Paths **no** agent may modify unless it names them in its own `writes`. Default: `<pi-crust>/runtime/modules/`, `.pi-crust/config/`, `<pi-crust>/runtime/stages/`, `<pi-crust>/runtime/lifecycles/` — an agent must not be able to edit the machinery that decides whether its work passed. |
| `data_dir`            | path                  | Runtime home. Sessions land at `{data_dir}/sessions/{run_id}/{agent_name}/`. Default `.pi-crust/data`.                                                                                                                                                                                      |

### `observability`

This block is no longer in `crust.config.yaml`. It lives in **`.pi-crust/config/crust.observe.yaml`**, beside it, which also carries the registered themes — everything about watching a run is in one file, and the roster file is about agents. `load-config.ts` reads it and merges it onto the loaded config under the key it always had, so every caller still reads `cfg.observability.db`, and a `crust.config.local.yaml` that sets `observability.poll_ms` still wins over it.

```yaml
# crust.observe.yaml
db: .pi-crust/data/crust.db
poll_ms: 500
ports:
  backend: 4600
  frontend: 4601
default_theme: auto
themes:
  - name: dark
    label: Dark
    builtin: true
  - name: high-contrast
    label: High contrast
    stylesheet: config/high-contrast.css
```

| Field            | Type | Meaning                                                                                                                         |
| ---------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------- |
| `db`             | path | SQLite trace db. `trace-db.ts` writes it directly; the visualizer polls it. Default `.pi-crust/data/crust.db`.                  |
| `poll_ms`        | int  | Visualizer live-poll cadence in ms. History uses the same queries, lazy-paged. Default `500`.                                   |
| `ports.backend`  | int  | The API `observe` boots, the UI proxies to, and every run probes before printing a link. `CRUST_BE_PORT` wins. Default `4600`.  |
| `ports.frontend` | int  | The web app `observe` boots, and the host of the link a run prints. `CRUST_FE_PORT` wins. Default `4601`.                       |
| `default_theme`  | name | Which registered theme the trace UI starts on. `auto` follows the system. Default `auto`.                                       |
| `themes[]`       | list | Every theme the picker offers — see the observability reference. A theme is `builtin: true`, or names a `stylesheet:` relative to `.pi-crust/`. |

### `agents[]`

| Field                                                               | Required | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                                                              | yes      | The identifier workflow scripts use. **workflows name agents, never models.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `purpose`                                                           | yes      | One sentence: what this agent is for. Should match its `system.md` Purpose.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `prompt_engineering.system`                                         | yes      | Path to the system prompt — who the agent is, its single purpose, its output contract.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `prompt_engineering.user`                                           | yes      | Path to the default user prompt — the task template with `{{prompt}}`, `{{previous_envelope}}`, `{{context_handoff_dir}}`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `color`                                                             | no       | Hex swatch (`"#a78bfa"`) for this agent's lane in the visualizer. Travels config → `agent_sessions.color` → `/api/sessions/:run_id`, and rides the `agent_start` event so a lane is colored while the agent is still running. Unset = the UI's fallback palette.                                                                                                                                                                                                                                                                                                                                          |
| `coding_agent`, `model`, `thinking`, `color`, `harness_engineering` | no       | Override the corresponding `defaults` key.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `tools`                                                             | no       | Allowlist. **Omitting the key means all tools usable.** A capability list, not a boundary — see `writes`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `writes`                                                            | **yes**  | What this agent may modify **in the repo**, and where its own document goes. Enforced after every call. `['*']` = unrestricted (still barred from `protected_files`). `[]` = modifies nothing. A list = only those paths: a trailing `/` is a directory prefix, `*` matches within one path segment, `**` crosses segments, `{handoff}` expands to this run's context_handoff directory, anything else is an exact path. Naming a `protected_files` path here is what unlocks it. **Required** — omitting it used to mean *unrestricted*, so the widest permission was the one granted by saying nothing. |

Output types are deliberately absent: config defines who an agent *is*; the workflow call site defines how it's *used*. One agent serves many calls — same system prompt, different user prompt + output type per call.

## Defaults merging

`execute-agent.ts` merges each entry **over** `defaults`, key by key. An entry states only what differs; anything unset inherits. `validateAgents(cfg, REQUIRED_AGENTS)` then confirms every name a workflow declares exists, resolves to a usable coding agent + model, and has both prompt files present on disk. Any miss fails the run immediately — **no agent is ever spawned against a half-valid config.**

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

`grep`, `find`, and `ls` are off in bare Pi, so an agent that does not name them will shell out through `bash` to do the same work. The starter roster therefore sets `defaults.tools` to all seven and lets each agent narrow from there.

**Resolution order:** an agent's own `tools` list wins; an agent that omits the key inherits `defaults.tools`; if neither is set, `tools` stays `None` and all tools are usable. An empty list is not "all tools" — it is a tool-less agent, and it will stall.

## Write permissions — `writes` and `protected_files`

`tools` cannot express a safety boundary, because two of the tools are general purpose. `bash` runs anything, including `git checkout`, which discards an engineer's uncommitted work; `write` reaches any path, not only the one report file an agent was granted it for. So "this agent changes nothing" is a claim a tool list can state but never keep.

`modules/use-cases/enforce-permissions.ts` keeps it, the same way every other claim in this system is kept — after the fact, against the repo. Before an agent's first prompt the working tree's change-set is fingerprinted; after its last send (including JSON retries and gate corrections) it is fingerprinted again. Any path that appeared, vanished, or changed is attributed to that agent.

Comparing change-sets rather than watching writes is deliberate: a path that was modified before the agent ran and is clean afterwards has been **reverted**, and a reversion is a modification. That is what catches `git checkout`.

A breach is not a gate violation. Gates are for work an agent can be asked to redo; a write has already happened, so re-prompting fixes nothing. Instead:

1. every unauthorized change the agent **introduced** is rolled back — tracked files with `git checkout --`, untracked files by deletion;
2. a path that was **already dirty** before the agent ran is left untouched. The operator had uncommitted work there, and discarding it to tidy up would be the same harm this module exists to prevent;
3. the activity run fails and names every path with what happened to it.

```yaml
defaults:
  protected_files: [<pi-crust>/runtime/modules/, .pi-crust/config/, <pi-crust>/runtime/stages/, <pi-crust>/runtime/lifecycles/]

activities:
  - name: builder
    writes: ['*']      # unrestricted, minus protected_files — said out loud
  - name: scout
    writes: ["{handoff}/scout_findings.md"]   # its findings, and nothing else
  - name: planner
    writes: [specs/]
  - name: documenter
    writes: [app_docs/, docs/, "**/*.md", "*.md"]
```

**The session runtime under `data_dir` is always writable, for every agent.** `context_handoff/` is how agents hand work to each other, and each agent's prompts, `raw_output.jsonl`, and `envelope.json` sit beside it. That grant comes from `data_dir` rather than from `.gitignore`: the runtime is normally ignored, so it never even appears in a snapshot, but an agent's ability to record its own work must not depend on a gitignore line someone can delete.

Narrow by role, not by reflex. Anything that must produce a `context_handoff/` artifact needs `write`, or it will resort to a `bash` heredoc. Withhold `edit`/`write` only where the restriction *is* the guarantee — a reviewer that cannot edit cannot quietly fix what it was asked to report.

### Extension tools must be named explicitly

`pi --tools` is an allowlist over **built-in, extension, and custom tools alike** — not just builtins. So the moment an agent has a `tools` list at all (its own, or one inherited from `defaults`), any tool registered by its `harness_engineering` extensions is **excluded unless it appears in that list by name**.

This fails quietly. The extension still loads, the run still succeeds, and the tool the extension exists to provide is simply never offered to the model — you find out by noticing the agent never called it.

```yaml
  - name: reviewer
    harness_engineering:
      - .pi/extensions/ast_query.ts     # registers tool: ast_query
    tools:
      - read
      - grep
      - find
      - ls
      - bash
      - ast_query                       # REQUIRED — the extension's tool, named or lost
```

Rule: **every entry in `harness_engineering` that registers a tool must have that tool name added to the agent's `tools` list.** Adding an extension is therefore a two-line change, never one. The alternative is dropping the `tools` key *and* leaving `defaults.tools` unset so the agent resolves to `None` (all tools) — but with a roster-wide `defaults.tools` in place, that escape hatch is closed; naming the tool is the only path.

## Where an Activity's document goes

An Activity that produces a document names it in `writes`, with `{handoff}` standing for this run's context_handoff directory:

```yaml
  - name: reviewer
    writes: ["{handoff}/review.md"]
```

The prompt renders `{{output_document}}` rather than a filename, so the path the agent is told to write and the path it is permitted to write are one declaration instead of two that can disagree. Sending an Activity's output somewhere else is then a configuration change:

```yaml
  - name: reviewer
    writes: [specs/review.md]
```

It is also what makes concurrency checkable. A Stage may only claim `strategy: concurrent` when its Activities' declared paths are disjoint, and that is a question about these lists — see the Lifecycles reference. An Activity declaring `['*']` overlaps everything and can never share a concurrent Stage.

Under concurrency this list is also how a write is attributed. Permission used to be enforced by diffing the working tree across the window an Activity ran in, which blames each of two concurrent Activities for the other's work. A path a sibling declared is that sibling's.

## Stopping the run for a person

`--approve-after` takes Activity names, and Stage names prefixed with `stage:`:

```bash
just crust sdlc "..." --approve-after plan,stage:accept
```

| Named          | Stage strategy | The run pauses                              |
| -------------- | -------------- | ------------------------------------------- |
| an Activity    | serial         | as soon as that Activity completes          |
| an Activity    | concurrent     | after every Activity in the Stage completes |
| `stage:<name>` | either         | after every Activity in the Stage completes |

An Activity gate inside a concurrent Stage cannot stop its siblings — they are already running, and an agent killed mid-write leaves the tree in a state nobody declared. The gate is recorded when the Activity finishes and enforced at the Stage boundary, naming the Activity that raised it.

The prefix exists because Activities and Stages share a namespace. A bare `accept` would be ambiguous the first time somebody names a Stage after an Activity it contains.

## Harness engineering

`harness_engineering` entries are pi extension **file paths**, passed through as `pi -e <path>`, one flag per entry, scoped to that agent only. This is where per-agent harness changes live — e.g. an output-tightening extension for an agent that keeps wrapping its envelope in prose. The starter roster ships with none. On Claude Code the field is reserved for MCP config and hooks in v2.

**If the extension registers a tool, name that tool in the agent's `tools` list too** — `--tools` filters extension tools exactly like builtins, so an unnamed extension tool is silently unavailable no matter that the extension loaded fine. See [Extension tools must be named explicitly](#extension-tools-must-be-named-explicitly) above. Extensions that only shape output or add flags (no tool registration) need no `tools` change.

## `routing:` — what agents load, what `verify` runs

The one section that may name a skill path or a checker command. Nothing in `<pi-crust>/runtime/modules/`, `<pi-crust>/runtime/stages/` and `<pi-crust>/runtime/lifecycles/`, or `<pi-crust>/runtime/prompt-engineering/` may name either: the factory is stamped into repositories whose conventions and toolchain it cannot know, so a path written into the tree is a path that does not exist there.

Both lists are selected by **the paths the change actually touched**.

```yaml
routing:
  skills:
    - name: code-review
      path: .claude/skills/code-review   # passed to the coding agent as --skill
      agents: [code-reviewer]            # omit to give it to every agent
      when: ["**/*.ts", "**/*.tsx"]
      activity runs: []                         # omit to give it to every activity run

    - name: respond-to-pr-comments       # how to ANSWER a review, so no `when:`
      path: .claude/skills/respond-to-pr-comments
      agents: [builder]
      activity runs: [revise]                   # `revise_2` matches this too

  checks:
    - name: test
      when: ["**/*.ts"]
      operation: test                    # lint | typecheck | build | test
      area: backend                      # frontend | backend (default: backend)
      argv: [bun, test]                  # argv LIST, binaries by BARE NAME
      cwd: ""                            # where to run it, from the git root
      with_changed_paths: false          # true appends the matched paths to argv
      timeout_seconds: 600
```

| Key                           | Default | Meaning                                                                                                                         |
| ----------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `skills[].path`               | —       | file or directory handed to the agent's harness, once per entry                                                                 |
| `skills[].agents`             | `[]`    | which agents receive it; empty means every agent                                                                                |
| `skills[].when`               | `[]`    | path globs; empty always matches                                                                                                |
| `skills[].activity runs`      | `[]`    | activity run names that receive it; empty is every activity run. An instance suffix is stripped, so `revise` matches `revise_2` |
| `checks[].argv`               | —       | at least one token; never a shell string                                                                                        |
| `checks[].with_changed_paths` | `false` | append the paths THIS rule matched, for checkers that take file arguments                                                       |
| `checks[].cwd`                | `""`    | directory to run in, relative to the git root; empty is the root itself                                                         |
| `checks[].timeout_seconds`    | `300`   | a timeout reports exit 124, with the output captured                                                                            |

### `cwd`, and why changed paths are rebased onto it

Changed paths are collected from the **git root**, so that is the spelling `when:` globs must use. A check that runs somewhere below the root — a nested workspace, a package with its own `tsconfig.json` or linter config — sets `cwd:`, and the paths appended by `with_changed_paths` are rebased onto it.

Without the rebase, a root-relative path handed to a command running in a subdirectory names a file that does not exist, and the tool reports a missing file rather than a misconfiguration. `.pi-crust/` sitting at the git root is the common case and needs neither key.

### Glob semantics, and the trap in them

`when` uses the same matcher as `writes:`: **`*` does not cross `/`, `**` does.** So `when: ["*.ts"]` matches `server.ts` at the repository root and nothing nested — and because the result is "no rule matched", it reads as silence rather than as an error. Write `**/*.ts` unless you mean the root only.

### Declaring nothing is not the same as passing

A `verify` activity run where paths changed and **no check matched them** FAILS, and says which. A repository that forgot to declare `routing.checks` would otherwise get a green verification forever — the classic "a rule reporting zero may be disabled rather than satisfied" failure. Three outcomes, all distinguishable in the trace:

| Changed paths | Matched checks | Verdict                                                |
| ------------- | -------------- | ------------------------------------------------------ |
| none          | —              | passed: nothing changed, no checks apply               |
| some          | 0              | **failed**: N path(s) changed but no rule matched them |
| some          | N              | whatever the commands said                             |

### How a skill reaches the agent

`executeAgent` resolves the list for the agent it is about to call — by agent name, by changed path, and by the activity run it is running — and passes each entry as `--skill <path>`. Two render variables carry the same information into the prompt, so an agent can be told to follow them without any prompt naming a path: `{{skills}}` (newline-separated, or `(none)`) and `{{changed_files}}`.

`activity runs:` is what makes "this skill is about how to answer a review" expressible: a skill routed to the builder's `revise` activity run reaches it and nothing else, where a `when:` glob would have given it to every build that touched the same files.

A code-review agent handed `(none)` must say so and withhold approval. A review with no conventions loaded is not a review, and inventing them is worse than declining.

## Overriding the roster on one machine

`crust.config.local.yaml`, beside the config it overrides, is gitignored and loaded automatically when present. A committed `crust.config.local.example.yaml` sits next to it showing the whole surface — copy it, drop the `.example`, and it is in force on the next run. Nothing reads the example; it exists so a developer joining the repository can see what a local layer may do without finding out by trial.

The example is refreshed by `install.ts --force` even though everything else in `config/` is left alone. It is documentation rather than tuning, and a copy frozen at whatever shipped first would quietly start describing keys that no longer exist. In a repository with several developers it is how one person's licences, models and preferences stay out of everyone else's runs.

It may override exactly four things, per agent or on `defaults`: `model`, `thinking`, `color`, `coding_agent`. Those are the keys that differ because a *person* differs — which models their credentials reach, how much thinking those models support, which harness they run, what colour they want a lane to be.

```yaml
# .pi-crust/config/crust.config.local.yaml — yours alone, never committed
defaults:
  model: openai/gpt-5.1

activities:
  - name: builder
    model: anthropic/claude-opus-5
    thinking: high
  - name: scout
    color: cyan
```

A local layer may set anything the committed file can, key by key, with the local value winning. There is no restricted subset. The restriction that used to be here — four keys, and no adding an agent — protected nothing: whoever writes the local file can equally edit the committed one, and runs the result on their own machine against their own checkout. There is no second principal to protect, and the restriction was friction in the one file whose purpose is to have none.

That makes the convention yours to keep rather than the tool's to enforce. A `writes` list narrowed locally is a run behaving differently from everyone else's for a reason no reviewer can see, which is worth avoiding by choice.

Adding an Activity belongs in `crust.activities.local.yaml` rather than here, because that is the registry a Lifecycle resolves names against. An Activity named here that the committed config does not have is a warning pointing at that file.

Naming an agent the roster does not have is a **warning**, not an error. Names go stale when somebody renames an agent upstream, and a colleague's private file must not break your run — but the warning is printed, because a typo that quietly did nothing is the confusion this is meant to avoid.

A run with a local layer in force says so on its first line, with the path. A gitignored file that silently changes which models are billed is the failure this prevents.

The path follows the config in force, so `--config other.yaml` reads `other.local.yaml`.

## Agent colours are theme roles

`color` names a role from the theme palette, not a hex:

```text
blue  amber  green  purple  cyan  pink  violet  orange  teal  indigo  rose  lime
```

Each theme decides what a role looks like — `amber` is `232 182 74` on dark and `150 100 10` on light, because the second has to be legible on white. The visualizer resolves a role to `rgb(var(--amber-rgb))` at render, so switching theme re-colours every lane, including lanes in runs recorded months earlier. That works because the trace stores the role it was given rather than a finished colour.

`red` is deliberately not offered. It means a failed activity run everywhere else in the interface, and an agent permanently wearing the failure colour reads as broken at a glance.

A hex still works and is honoured verbatim. It is the escape hatch for a colour the palette does not have, and it is theme-unaware by definition: it will be whatever you wrote on every theme, and its contrast is yours to own rather than the theme's.

An agent that names nothing takes a role by position, so adjacent lanes in a waterfall always differ. Twelve roles cover a roster of eighteen agents, which means two agents far apart in the list can share — distinguishable in practice, because what matters is the lanes on screen together.

## What the interactive menu offers, and in what order

Everything registered in `crust.activities.yaml`, in the order that file declares them, with the Lifecycles from `crust.lifecycles.yaml` above them and the Operator between. Reorder the registry to reorder the menu; nothing else records a sequence, so nothing else can drift out of step with the Activities that exist.

`hidden: true` on an Activity keeps it out of the menu, for people who drive the factory with Lifecycles or a Planner and never pick it by hand.

Hidden is not disabled, and the distinction is deliberate. A Lifecycle, a Planner and an explicit `--steps` all still run a hidden Activity. Hiding is a preference about a menu; disabling would be one developer quietly running a shorter chain than the repository agreed to.

Because the flag lives on the Activity, a local layer can hide one without changing what the team ships:

```yaml
# crust.activities.local.yaml
activities:
  - name: security-researcher
    hidden: true
```

The menu lists the work rather than the performer: a registry entry is named for who does it (`planner`), and the thing you pick is what gets done (`plan`). An Activity is hidden through the performer the registry binds each step to.

There is no `steps` block. It held an `order` and a `hidden` list, and both are gone — presentation order is the registry's order, and hiding is a property of the Activity. Execution order comes from the Lifecycle, or from the list given to `--steps`.

When a chain needs a different order for one run, press `r` at the menu. That opens an ordering screen where the arrows move the cursor and `j`/`k` move the selected item.

## The trust dial has four behaviours, so it has four names

```text
none    every question stops the run, trivial ones included
low     every consequential question stops it
medium  it decides what it can defend and reports it; a question it could not
        answer, or an action reaching beyond this run, stops it
high    nothing stops it unless you asked with --approve-after
```

The axis is the run's blast radius, not the importance of the subject. Two things stop a medium run and only two: an empty `provisional_answer`, which means the stage had no answer it could defend and proceeding would be invention; and `beyond_this_run: true`, which means acting would reach outside what discarding the run's output would undo — a push, a deploy, a migration against real data, spend.

It used to be irreversibility, and that was wrong in a way worth recording. An agent correctly calls a schema irreversible, so a run that was only writing a *document* about a schema stopped at nearly every step. Measured across every question the factory has written, 12 of 40 carried both flags, and they were questions like "which naming survives" and "is that year 2026 or 2025" — things a colleague decides, states, and is corrected on later.

Each level is now rendered into every agent's prompt as `{{trust_stance}}`. Before, no prompt mentioned the dial at all: it filtered the agent's classification after the fact, so raising it could not make an agent try harder to settle anything. A setting the worker cannot see is a report filter, not a setting.

`--trust-level medium` and `CRUST_TRUST_LEVEL=high` are the way to say it. Numbers still work, because the trace, the flag and the config have recorded them from the start — but there are exactly three thresholds, so 60, 80 and 50 are the same run. A number between thresholds now says which band it landed in: `trust 80 behaves as medium (50)`. Accepting a precision the dial does not honour and then printing the number back is how somebody believes they tuned something.

`just crust please` offers three: low, medium, high. `none` is a debugging setting rather than a way to work, and offering it in a menu invites somebody to pick it once and conclude the whole thing is unusable. It is still there on the flag.

The default is medium, set in one place — `TRUST_DEFAULT` — and overridable per developer in `crust.config.local.yaml` or for one shell with the environment variable.
