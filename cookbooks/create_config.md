# Create Config

Generate `crust.config.yaml` — the agent roster for a target repo.

## Generate it

```bash
bun <pi-crust>/scripts/make-config.ts
```

Writes `.pi-crust/config/crust.config.yaml` — creating the directory if needed — with the defaults and routing a stamp starts from. The Activities themselves live beside it in `crust.activities.yaml`, wired to the prompt files `/skill:crust install` stamped into `<pi-crust>/runtime/prompt-engineering/`. That path is the default every workflow and the justfile look for; `--config` overrides it. `make-config.ts` refuses to overwrite an existing config unless you pass `--force`, so retuning an existing roster is a hand edit — see `update_config.md`.

`make-config.ts --force` explicitly replaces this one config file. It is not the installer's refresh policy: `install.ts --refresh` neither adds nor overwrites non-example files once `config/` exists. Only new `.example.yaml` documents are added there, and existing examples refresh only when requested. See [install.md](install.md) for deliberate adoption of new settings and the installer's deprecated `--force` alias.

## The rule

**One Activity, one prompt, one purpose.** An entry defines both halves of it: who performs it — coding agent, model, thinking level, exactly one system prompt and one user prompt — and what the work is, through `output`, `gates`, `input`, `attempts` and `commit`. They are one thing, because a Lifecycle names `plan` and `plan` IS the entry.

## Schema

```yaml
defaults:
  coding_agent: pi                 # v1: pi only (claude_code is specced, stubbed until v2)
  model: google/gemini-3.6-flash   # ALWAYS provider/model-id — a bare id is ambiguous
  thinking: medium                 # off | minimal | low | medium | high | xhigh | max
  harness_engineering: []          # pi extension names
  data_dir: .pi-crust/data          # runtime home: {data_dir}/sessions/{run_id}/{agent_name}/

# Watching a run — the trace database, the UI's ports, the themes it offers —
# is crust.observe.yaml, beside this file. See references/config.md.

# crust.activities.yaml, beside it
activities:
  - name: plan                     # named for the WORK, which is what a Lifecycle names
    coding_agent: pi
    model: google/gemini-3.6-flash
    thinking: high
    color: violet                  # a theme role, never a hex
    purpose: Turn a request into a plan the builder can implement without asking questions.
    prompt_engineering:
      system: <pi-crust>/runtime/prompt-engineering/plan/system.md
      user: <pi-crust>/runtime/prompt-engineering/plan/user.md
    output: planOutput             # the envelope contract it answers, by published name
    gates: [artifactsExist, filesNonEmpty]

  - name: scout
    thinking: high                 # unset keys fall through to defaults
    purpose: Find and report where things live; change nothing.
    prompt_engineering:
      system: <pi-crust>/runtime/prompt-engineering/scout/system.md
      user: <pi-crust>/runtime/prompt-engineering/scout/user.md
    output: scoutOutput
    gates: [artifactsExist]
    tools:                         # optional allowlist — omit the key entirely for all tools
      - read
      - bash
```

Every agent entry merges over `defaults`, so an entry only states what differs. Pi's builtin tools are `read`, `bash`, `edit`, `write` — a read-only recon agent gets `[read, bash]`; a builder omits `tools` altogether.

## After generating

1. Each agent needs its prompt pair to exist on disk: `<pi-crust>/runtime/prompt-engineering/{name}/system.md` and `user.md`. `validateAgents()` fails the run at startup if either is missing.
2. Write `purpose` as one sentence and make the system prompt say the same thing — the two should not drift.
3. Validate by running the smallest workflow that names your agents; a bad entry fails fast, before anything spawns.

Full field-by-field spec, thinking-level mapping, and model resolution: `references/config.md`. Retuning an existing roster: `update_config.md`.
