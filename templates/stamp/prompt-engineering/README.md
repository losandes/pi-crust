# Prompts

Every Activity's prompts ship with pi-crust. This directory is for yours.

## Overriding one

Point the Activity at your file in `config/crust.activities.yaml`:

```yaml
- name: planner
  prompt_engineering:
    system: .pi-crust/prompt-engineering/planner/system.md
```

A key you do not mention keeps the shipped prompt, so overriding the system prompt alone leaves the user prompt as it was.

## Adding one

An Activity you register yourself names its prompts the same way. There is no registry of prompts and no naming rule — the path in the configuration is the whole mechanism.

## Why nothing is stamped here

A copy of a shipped prompt would be a file you did not write, that pi-crust also owns, that an update has to decide about. Keeping them in the package means an improvement reaches you, and anything in this directory is yours because you put it there.

`example/` is gitignored for the same reason: it illustrates the shape and is not yours to maintain.
