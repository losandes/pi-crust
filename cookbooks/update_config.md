# Update Config

Add or retune Activities in `crust.activities.yaml`, and the roster-wide defaults and tasks in `crust.config.yaml`.

## Retune model or thinking

Edit the agent's entry in place:

```yaml
  - name: build
    model: google/gemini-3.6-flash   # ALWAYS provider/model-id
    thinking: high                   # was medium
```

Write the model as `provider/model-id`, never a bare id. The same model is usually carried by several providers, and an ambiguous pattern raises in `validateAgents()` — grounding every agent that inherits it. See `references/config.md`.

Thinking levels are Pi's reasoning effort: `off | minimal | low | medium | high | xhigh | max`. It only bites when the model is registered with `reasoning: true` in `~/.pi/agent/models.json`.

**A model change means a fresh session.** `agent_map.json` records the model each coding-agent session was created with. When a joined run (`--run-id`) finds the config's model no longer matches the recorded one, that agent starts a **new** session rather than resuming — the map is updated, never a bad resume. Thinking changes do not invalidate a session; model changes do. Expect the agent to lose its accumulated context window on the first run after the change.

## Recolor an agent's lane

```yaml
  - name: build
    color: cyan           # a theme role; the registry ships violet/cyan/amber/green
```

Purely cosmetic and safe to change mid-project: the color rides the `agent_start` event and the `agent_sessions` row, so the visualizer picks it up on the next run without touching past sessions. Omit the key to let the UI's fallback palette choose.

## Retune tools

Pi's seven builtins: `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`. The last three are **off in bare Pi**, so an agent that doesn't name them will shell out through `bash` to search and list.

Set the roster-wide floor in `defaults`, then narrow per agent:

```yaml
defaults:
  tools: [read, bash, edit, write, grep, find, ls]

activities:
  - name: outcome-review
    tools:                # explicit list wins over defaults
      - read
      - grep
      - find
      - ls
      - bash
      - write
```

**Resolution:** the agent's own list wins → else it inherits `defaults.tools` → else `None`, meaning all tools. An empty list is not "all tools"; it is a tool-less agent, and it will stall.

Narrow by role, not by reflex:

- Any agent that must produce a `context_handoff/` artifact needs **`write`** — without it, it falls back to a `bash` heredoc to create the file the gate checks for.
- Withhold `edit`/`write` only where the restriction *is* the guarantee. The reviewer's contract is "change nothing", so withholding `edit` makes that structural instead of merely prompted.
- Recon agents should get the full read surface (`read`, `grep`, `find`, `ls`) — cheaper and more legible in the trace than the equivalent `bash` calls.

Every agent loads the package's path-policy extension. Configuration cannot add an extension or replace that policy.

## Add a new Activity

Two steps, and then it is runnable. There is no third edit anywhere in the package — that is the whole point of the registry being configuration.

1. **Prompts.** Create `.pi-crust/prompts/{name}/system.md` (Purpose + Instructions — the Activity's static identity, nothing else) and `user.md` (an h3 per incoming datum: `{{prompt}}`, `{{previous_envelope}}`, `{{context_handoff_dir}}`, then the task, then a `## Report` section showing the exact output JSON). Copy an existing pair as the shape.
2. **Registry entry** in `crust.activities.yaml`. Name it for the WORK, give it a `purpose`, its prompt refs, its `writes`, and the work half: `output`, and `attempts` or `commit` where the defaults are wrong. The engine derives [output checks](../references/config.md#output-checks) from `output`. An `output` the package does not publish is refused at load, listing what it does publish — so a typo costs a second, not a run.

Then name it in `--activities`, or in a Stage in `crust.lifecycles.yaml`. If none of the published envelope specs fits its report, add one — see `update_modules.md` — and the user prompt's `Report` section must show exactly that shape.

## Rules that do not bend

- a Lifecycle names **Activities**, and an Activity IS its agent; nothing outside the configuration names a model. Swapping a model is a config edit and touches no code.
- One Activity, one prompt, one purpose. If an entry needs two purposes, it is two Activities.
- A **Planner** is not an Activity. `operator` and `triage` live under `planners:`, a Lifecycle cannot name them, and configuration can tune them but never add a third.

Full spec: `references/config.md`.
