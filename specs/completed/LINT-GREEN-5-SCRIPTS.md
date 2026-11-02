# Refactor: scripts and templates lint clean, and the repository is green

## Objective

One diagnostic remains outside `apps/visualizer` and `runtime`: a `noTemplateCurlyInString` warning in `scripts/install.ts`, where a single-quoted TypeScript string holds a line of bash containing a shell parameter expansion. It is resolved, and with it the whole repository reaches zero diagnostics — errors and warnings both.

## 1. Requirements

### 1.1 The scope

1.1.1 The `lint/suspicious/noTemplateCurlyInString` diagnostic in `scripts/install.ts` MUST be resolved. It is reported on a line of generated bash containing a shell parameter expansion inside a single-quoted TypeScript string, which the rule mistakes for a JavaScript template placeholder written in the wrong quotes.

1.1.2 Every other diagnostic in `scripts` and `templates` MUST be resolved, after which `bun x biome check scripts templates` MUST exit 0 and report no diagnostic lines. The two paths MUST be checked together: `templates` holds no file the configuration's `includes` matches, so checking it alone exits 1 with "These paths were provided but ignored" rather than reporting a clean scope.

1.1.3 No file outside `scripts` and `templates` MUST be modified.

1.1.4 This stage MUST be settled by the diagnostic count rather than by an exit code: the remaining diagnostic is a warning rather than an error, so `bun x biome check scripts` already exits 0 while it stands.

### 1.2 How this one is resolved

1.2.1 The bash the installer generates MUST be byte-identical after the change. The generated stamp script is executed by every stamped repository, and a changed expansion is a broken install rather than a lint fix.

1.2.2 If the resolution is a refactor — splitting the string, or building the expansion from concatenated parts — the generated output MUST be proven identical, not assumed.

1.2.3 If no refactor preserves the output and keeps the bash readable, a suppression MUST be proposed under 1.3. This is the most likely outcome and it is a legitimate one: the rule is about JavaScript template placeholders, and this string is bash.

### 1.3 Suppressions need approval

1.3.1 A suppression comment MUST NOT be added without the developer's explicit approval of that specific comment, obtained before this work is reported finished.

1.3.2 A proposed suppression MUST be presented with the file, the line, the rule, and the reason the rule does not apply there, and the run MUST wait for a decision.

1.3.3 Every approved suppression MUST name the rule and carry a reason, and MUST NOT use the bare `// biome-ignore lint:` or unqualified `// biome-ignore lint/plugin:` forms.

1.3.4 `biome.json` MUST NOT be edited: no rule disabled, no override added, no `includes` narrowed, no plugin removed.

### 1.4 The repository-wide claim

1.4.1 With this stage finished, `bun run lint` MUST exit 0.

1.4.2 With this stage finished, the repository MUST report zero diagnostic lines, warnings included. `biome check` exits 0 with warnings outstanding, so the exit code alone MUST NOT be offered as evidence.

1.4.3 If a diagnostic remains anywhere, this stage MUST report it and name the earlier document that owns it rather than fixing it here.

1.4.4 `AGENTS.md` MUST be updated: the paragraph stating that lint "is not green yet" and pointing at the issue tracking the backlog is no longer true and MUST be replaced with the standing expectation that `bun run lint` passes.

1.4.5 The existing instruction in `AGENTS.md` that lint is only ever settled by a whole-repository run, and that narrowing `includes` to make a job pass is ruled out, MUST survive that edit.

### 1.5 Behaviour and reporting

1.5.1 The installer's behaviour MUST NOT change. The stamp it writes, the files it copies, and the paths it records MUST be identical.

1.5.2 A fresh install MUST still verify clean, proven by the probe in `AGENTS.md` that installs into a temporary directory and runs the drift check.

1.5.3 The run MUST report every suppression it proposed, whether approved or not.

1.5.4 The run MUST report every case where it followed an existing pattern in this repository in preference to the lint rule, a convention document, or an architecture record — naming the file, the rule, and the pattern it followed.

## 2. Target state

The reported line and the suppression form it most likely needs:

```ts
// scripts/install.ts — a line of generated bash, not a JavaScript template
// biome-ignore lint/suspicious/noTemplateCurlyInString: bash parameter expansion in generated shell, not a JS placeholder
'    home="${CRUST_HOME:-}"',
```

Where this and the prose disagree, this governs the form. Whether a suppression is used at all is 1.2.3's question and requires approval under 1.3.

## 3. Out of scope

- `apps/visualizer` and `runtime`, finished by the four earlier documents.
- `biome.json` and the plugins in `.biome/`.
- Enabling `.biome/no-throw.grit`.
- What the installer generates. 1.2.1 and 1.5.1 forbid changing it; this is a lint fix on the TypeScript that emits bash, not a change to the bash.
- The coverage gate and the test suite, neither of which this stage touches.

## 4. Work stages

| #   | Change                                      | Proven by                                                                      |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------ |
| 1   | 1.1.1, 1.1.2 — the scope is clean            | `bun x biome check scripts templates` exits 0 and prints no diagnostic line     |
| 2   | 1.2.1, 1.2.2, 1.5.1, 1.5.2 — the stamp is identical | `probe="$(mktemp -d)" && (cd "$probe" && bun "$OLDPWD/scripts/install.ts" && "$OLDPWD/scripts/verify-install.sh"); rm -rf "$probe"` reports `drift=0` |
| 3   | 1.4.1 — the linter passes                    | `bun run lint` exits 0                                                         |
| 4   | 1.4.2 — nothing is left, warnings included   | `bun run lint --max-diagnostics=500 2>&1 \| grep -cE '^[^ ]+:[0-9]+:[0-9]+ '` prints `0`. The pattern anchors on `path:line:column` and MUST NOT assume a repository-relative path: the pinned Biome prints absolute ones |
| 5   | 1.4.4, 1.4.5 — the documentation is true     | `grep -c 'not green yet' AGENTS.md` prints `0`                                 |
| 6   | whole document — nothing else regressed      | `bun run test:agent` exits 0; `bun run typecheck` exits 0; `bun run build` exits 0 |

## 5. Rationale

This stage is one warning and a documentation edit, and it is last because sequencing it earlier would spend a review round on a single line.

The diagnostic itself is the clearest false positive in the repository, and it is worth being precise about why rather than suppressing it on instinct. `noTemplateCurlyInString` exists to catch `'Hello ${name}'` — a placeholder written in quotes that do not interpolate, so the author gets a literal dollar-brace instead of a value. Here the literal dollar-brace is exactly what is wanted: the string is a line of bash being written to a file, and `${CRUST_HOME:-}` is a shell parameter expansion that the shell, not JavaScript, will expand later. The rule is reading the right pattern in the wrong language.

That makes 1.2.1 the load-bearing requirement rather than the lint fix. `AGENTS.md` is explicit that `.pi-crust/data/` cannot be regenerated and that an install may replace anything the template owns, so the installer is the one script in this repository where a cosmetic edit has a blast radius measured in other people's repositories. Proving the generated bash is byte-identical — through the install-and-verify probe, not by reading the diff — is cheap and the alternative is not.

Updating `AGENTS.md` is part of this stage because the sentence "it is not green yet" stops being true at the moment this stage lands, and a verification document that describes a state the repository has left teaches the next reader to distrust the rest of it. The instruction that survives — that the claim is only ever settled by a whole-repository run, and that narrowing `includes` is ruled out — is the part that matters more once the backlog is gone than it did while it existed.
