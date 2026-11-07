---
Context: All apps
---

# Use present-tense-imperative-verb-phrases

## Status

accepted

## Decision

Use present-tense-imperative-verb-phrases in branch names and the descriptive part of the commit messages.

## Context

### Branches

Name your branches using the following convention: `<name>/<conventional-commit-type>-<present-tense-imperative-verb-phrase-in-lower-kebab-case>`

Where `<name>` is your first name, `<conventional-commit-type>` is based on [conventional commits](https://www.conventionalcommits.org/en/v1.0.0/) (e.g. feat, fix, docs, BREAKING CHANGE), and the phrase captures what you are working on succinctly.

- `andy/docs-add-contributing-conventions`
- `alex/feat-add-router`
- `pete/fix-handle-multiple-router-variables`

Imperative means `add`, not `adds`. "Add contributing conventions" is an instruction; "adds contributing conventions" is a description of someone else's work. The same verb form applies to the commit description.

### Commits

Read [use-conventional-commits.md](./use-conventional-commits.md) before continuing. Also use present-tense-imperative-verb-phrases in the descriptive part of the commit message.

Add context that CLAUDE can use to produce release notes and PR/MR descriptions to the commit message.
