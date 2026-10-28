# Getting `biome lint` to pass

A temporary working document. Delete it when the last job is done.

## Why there is a backlog at all

Biome was never run in this repository before the lint configuration and plugins landed. `apps/visualizer` uses oxlint and has never been linted by Biome at all. So this is a first enforcement rather than a regression, and almost every finding is a genuine convention violation rather than noise.

The plugins are in `.biome/` and the conventions they enforce are stated in each diagnostic. Read `.biome/README.md` before starting — in particular "Scope is not a dial", which rules out the shortcut of narrowing `includes` to make a job pass.

## The command that defines done

```bash
bunx @biomejs/biome lint --max-diagnostics=500 .
```

Exit 0, and the summary line reading `Found 0 errors`. Run it from the repository root. Do not substitute a narrowed path for the final check: a job may be verified narrowly while in progress, but the claim "lint passes" is only ever settled by the whole-repository run.

The count at the time of writing is **141** — 139 errors and 2 configuration infos.

## Inventory

| Count | Diagnostic | Job |
|---|---|---|
| 47 | `push` mutates in place | 3, 4, 5 |
| 30 | property assignment builds a new value | 3, 5 |
| 22 | `catch` with no binding | **6** |
| 18 | avoid intermediate exception handling | **6** |
| 8 | `lint/style/noNegationElse` | 1 |
| 5 | `pop` mutates in place | 4, 5 |
| 3 | `Object.assign` writes into its first argument | 2, 5 |
| 3 | `++` mutates the property in place | 5 |
| 2 | configuration deserialize infos | 1 |
| 1 each | index assignment, `length` assignment, `+=` | 2, 3 |

By file, largest first. The two largest are a third of the work between them.

| Count | File | Kinds |
|---|---|---|
| 31 | `templates/pi-crust/harness-engineering/subagents.ts` | 19 prop-assign, 5 push, 3 `++`, 2 pop, 1 catch, 1 negation |
| 15 | `apps/visualizer/src/lib/markdown.ts` | 14 push, 1 length-assign |
| 8 | `apps/visualizer/server/db.ts` | 3 push, 2 Object.assign, 2 catch, 1 negation |
| 7 | `apps/visualizer/server/workspaces.ts` | 4 catch, 3 pop |
| 6 | `apps/visualizer/src/lib/use-trace.ts` | 4 prop-assign, 1 push, 1 catch |
| 6 | `scripts/install.ts` | 6 push |
| 5 | `apps/visualizer/src/lib/artifacts.ts` | 3 catch, 2 push |
| 5 | `apps/visualizer/src/lib/fences.ts` | 4 push, 1 catch |
| 4 | `apps/visualizer/src/lib/activity-run-facts.ts` | 4 catch |
| 4 | `apps/visualizer/src/lib/use-trace.test.ts` | 2 prop-assign, 1 push, 1 `+=` |
| 4 | `templates/pi-crust/consult.ts` | 2 push, 1 prop-assign, 1 catch |
| 3 | `apps/visualizer/src/components/SessionTrace.tsx` | 2 push, 1 index-assign |
| 3 | `apps/visualizer/src/lib/format.ts` | 2 catch, 1 push |
| 3 | `apps/visualizer/src/lib/highlight.ts` | 2 negation, 1 catch |
| 3 | `apps/visualizer/src/lib/narration.ts` | 2 push, 1 catch |
| 2 each | `server/index.ts`, `PhaseDetail.tsx`, `SessionCard.tsx`, `lib/events.ts`, `lib/token.ts`, `theme/theme.ts`, `templates/pi-crust/workspaces.ts`, `biome.json` | mixed |
| 1 each | `server/registry.ts`, `NarrationPane.tsx`, `SessionContext.tsx`, `lib/api.ts`, `lib/consult.ts`, `lib/ledger.ts`, `lib/router.ts`, `lib/use-poll.ts`, `lib/use-prompts.ts`, `lib/waterfall.ts`, `lib/waterfall.ts`, four factory files, `please.ts`, `steer.ts` | mixed |

## How to work

Each job below is a commit. They are ordered so the repository is never left in a worse state than it started, and so the hardest judgement is last. Job 0 comes first because it can change the number every other job is measured against.

Jobs 0 to 5 are mechanical in the sense that the right answer is known. They are not mechanical in the sense of a codemod: `push` inside a loop that also branches, or an object assembled across twenty lines, needs reading. Do not batch-edit with a regular expression.

After each job: run the whole-repository command, confirm the count fell by the amount the job claims, and run the affected package's tests. The visualizer and the factory have separate suites:

```bash
(cd apps/visualizer && bun test && bun x tsc --noEmit)
(cd templates/pi-crust && bun test && bun x tsc --noEmit)
```

A convention fix that changes behaviour is a bug, and these suites are the only thing that will say so.

## Job 0 — narrow the suppressions that already exist

**14 suppressions. No diagnostic count attached, and that is the point.**

Every one is written unqualified as `// biome-ignore lint/plugin: <reason>`, which silences *every* plugin on that line rather than the one the author meant — including rules written after the comment. They were written before the qualified form was known to work.

| Count | File |
|---|---|
| 4 | `templates/pi-crust/modules/data/handoff-snapshot.ts` |
| 2 | `templates/pi-crust/modules/data/pi-agent.ts` |
| 1 each | `modules/data/{visualizer,inbox,artifact-lock,workspace-registry,trace-db}.ts`, `modules/use-cases/{run-activity run,run-workflow}.ts`, `apps/visualizer/src/lib/use-trace.ts` |

Find them:

```bash
rg -n 'biome-ignore lint/plugin:' --glob '!node_modules'
```

For each, read the reason, work out which rule it was written for, and qualify it — `// biome-ignore lint/plugin/no-array-mutation: <same reason>`. The rule name is the plugin's filename without `.grit`. A wrong name is safe: Biome reports an unused suppression and leaves the original diagnostic in place, so a mistake here fails loudly.

Do this first, before Job 1. **The total may rise**, because a broad suppression can be masking a second violation on the same line that nobody has seen. A count that goes up here is the job working, not a regression — record the new number and carry it forward, since every later job measures progress against it.

## Job 1 — the built-in rule and the configuration

**10 diagnostics. No behaviour change.**

Eight `noNegationElse`: invert the condition and swap the branches.

- `apps/visualizer/server/db.ts:47`
- `apps/visualizer/src/components/PhaseDetail.tsx:584`, `:799`
- `apps/visualizer/src/lib/highlight.ts:31`, `:35`
- `templates/pi-crust/harness-engineering/subagents.ts:742`
- `templates/pi-crust/modules/data/pi-agent.ts:180`
- `templates/pi-crust/please.ts:304`

Two configuration infos in `biome.json`:

- `:2` — the `$schema` URL pins 2.2.0 while the CLI is 2.5.15. Update the URL to match the installed version.
- `:48` — `linter.rules.recommended` is deprecated in favour of `preset`. Migrate the key. Confirm afterwards that the same rules are still enabled: a renamed key that silently changes the rule set would make later jobs look smaller than they are.

Start here. It is the only job whose result is certain, and it shrinks the noise in the output you will read for the rest of the work.

## Job 2 — the one-offs

**6 diagnostics across 5 files.**

- `Object.assign` ×3 — `server/db.ts` ×2, `modules/data/abandoned-activity-runs.test.ts` ×1. Replace with spread. In `db.ts` both decorate a row with a `workspace` label; build the new row instead.
- index assignment ×1 — `SessionTrace.tsx`. Use `with(index, value)`.
- `length` assignment ×1 — `markdown.ts`. Use `slice`, or build the shorter array.
- `+=` ×1 — `use-trace.test.ts`.

Small, unrelated, and each stands alone. Doing them together keeps them out of the way of the bigger jobs.

## Job 3 — `push` accumulation in the visualizer

**~27 diagnostics**, concentrated in `src/lib/markdown.ts` (14), `fences.ts` (4), `server/db.ts` (3), `narration.ts` (2), `artifacts.ts` (2), `SessionCard.tsx` (2), `SessionTrace.tsx` (2), and one each in `use-trace.ts`, `events.ts`, `format.ts`, `waterfall.ts`.

The usual shape is a loop that appends to a local array. Most become `map`, `filter`, or `flatMap`. A loop that appends conditionally becomes `filter` then `map`, or a single `flatMap` returning `[]` for the skipped case. A loop that carries state across iterations becomes `reduce` — and if the `reduce` is harder to read than the loop was, that is worth saying in the commit rather than forcing it.

`markdown.ts` is a parser and the largest single file. Expect it to resist: parsers accumulate by nature. It may be the one place where a suppression with a real reason is the honest answer. Decide that per site, not for the file.

## Job 4 — `pop` and the remaining array mutation

**~8 diagnostics.** `server/workspaces.ts` ×3, `subagents.ts` ×2, and the rest singly.

`pop` conflates reading the last element with removing it. Where only the value is wanted, `at(-1)`. Where the shorter array is wanted, `slice(0, -1)`. Where both are wanted, take both and do not mutate.

## Job 5 — the two hard files

**~34 diagnostics.** This is the job that needs judgement, and it should be two commits rather than one.

**`templates/pi-crust/harness-engineering/subagents.ts` — 31.** A pi extension written in an imperative style: 19 property assignments, 5 `push`, 3 `++`, 2 `pop`. It is the single largest concentration in the repository. Read it end to end before changing anything; the mutations are likely to be one or two accumulating structures rather than 31 independent decisions. If it turns out to be a state machine that genuinely wants mutation, say so and suppress deliberately — but only after establishing that, not as the opening move.

**The remaining property assignments — 11.** `use-trace.ts` ×4, `templates/pi-crust/workspaces.ts` ×2, `use-trace.test.ts` ×2, and one each in `router.ts`, `steer.ts`, `consult.ts`. Smaller, and each is a value being decorated after construction. Build it decorated.

Note on the tests: `use-trace.test.ts` and `abandoned-activity-runs.test.ts` appear in this backlog. Test code is not exempt — the rules are configured at the top level deliberately — but a fixture assembled by mutation is a weaker violation than production code doing it. Fix them the same way; flag it if a fixture becomes materially harder to read.

## Job 6 — the catch sites

**40 diagnostics. Do not start this job until the decision below is made.**

22 are `catch` with no binding, 18 are `catch (e)`. They are spread across 20 files: `activity-run-facts.ts` ×4, `workspaces.ts` ×4, `artifacts.ts` ×3, `db.ts` ×2, `format.ts` ×2, `token.ts` ×2, `theme.ts` ×2, and one each in fourteen others including four factory files and three tests.

### The decision

**Suppress at boundaries, or convert to settlements?**

Both are defensible, and the rule was written expecting the second while the codebase was written expecting the first.

**Suppress.** Most of these wrap `JSON.parse`, `fetch`, `readFileSync`, or `localStorage` at a place that genuinely is a boundary — a server route, a CLI entry point, a theme loader reading a value that may not exist. The rule's own diagnostic says a boundary should suppress. Cost: 40 suppression comments, each needing a real reason. Write them as `// biome-ignore lint/plugin/no-intermediate-try-catch: <reason>` — the qualified form silences only that rule, so the comment cannot grow to cover a future diagnostic on the same line.

**Convert.** Introduce a settlement helper — `templates/pi-crust/modules/typedefs/settlement.ts` already defines the shape for the factory, and the visualizer has nothing equivalent — and wrap each throwing call so the failure becomes a returned value. Cost: a new module in the visualizer, and the change ripples into every caller that now receives a settlement instead of a value or an exception.

### What the decision needs

- **Does the visualizer get a settlement type?** It currently has none. Adding one is a architectural decision about that app, not a lint fix, and it should be decided on its own merits rather than because a linter asked.
- **Which of the 40 are genuinely boundaries?** Nobody has classified them. That classification is the first half of this job under either answer, and it is the thing that makes the suppression reasons honest rather than boilerplate.
- **Is `no-throw` ever going to be enabled?** It is currently shipped but unlisted in `biome.json`. If the answer is yes, converting catches is a step on that road and the investment compounds. If no, suppression is cheaper and loses nothing.

### What was already established, so it does not have to be rediscovered

Converting catches does **not** materially advance `no-throw`. They are nearly disjoint populations: of 78 `throw` statements in the repository, exactly **one** is a rethrow inside a catch. A catch consumes an exception a library produced; a `throw` is this code producing one. Fixing all 40 catches would remove one throw site.

The 63 non-test `throw` statements are 34 in factory `use-cases/`, 8 in `data/`, 5 at CLI entry points, and the rest scattered. They are argument validation and invariants — `throw new Error('an run-id is required')` — not wrapped library failures. Converting them changes function signatures and ripples through every caller. That is a project, not a cleanup, and it is the reason `no-throw` is off.

## When all seven are done

- `bunx @biomejs/biome lint --max-diagnostics=500 .` exits 0
- both test suites pass
- delete this file in the same commit as the last job
