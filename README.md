# pi-crust

Run a structured SDLC of observable, autonomous, optionally-unattended, specialist AI agents in your repo. Watch it run, ask it questions, and steer it in mid-flight in the terminal or with the included web app. Connect from anywhere on your network. Revisit past sessions, branch new ones, or dive into how it produced it's outcomes with SQLite traces, archived sessions files, and web design that pulls what's important to the foreground.

## Why

Four problems, and none of them is "write better code than a developer working with an agent directly".

**An agent follows a process differently every time.** You agree on plan, build, test, review — and then it is followed approximately. An Activity gets skipped because the change looked small; a suite is reported passing from a run three edits ago. Nothing stops it, because the process lives in prose that a model interprets.

**A claim and a fact are indistinguishable in prose.** "All 97 files are correct" reads the same whether anything was checked. Failures like these increase costs when we ship bugs to production.

**Authority asserted in a prompt is not authority.** "You are a reviewer; do not change code" is a sentence a model may ignore, and nobody finds out until it has.

**Working memory is fragile.** Everything an agent knows lives in a context window. Compaction eats it, a new session starts blind, and the thread gets rebuilt from `git log`.

### What it does not solve

**This is for work you walk away from.** It will not out-think an attended session, where you continualy steer the agent toward a desired outcome. It is not cheaper or faster. It keeps working on what you asked it to, and can explore what you ask it to from many different angles with just a few choices you make up front.

If you will always be at the keyboard, just run pi, claude, or whatever.

## How

**The sequence is a data structure, not an instruction.** A workflow is a list of Activity names folded by a function. A model cannot skip a stage, because the model is not doing the sequencing. Deterministic code runs the sequence, and calls specialist agents when it's their turn.

**Every claim is addressable.** Agents return typed envelopes, not prose, and the harness verifies them before accepting. A path claimed as changed must exist. An approval that ships blocking items is refused. A verification that matched no checks fails. An agent that doesn't finish it's work is re-prompted rather than credited.

**Each stage reduces one named class of uncertainty**, and hands the next stage a context envelope that distinguishes what it established from what it decided, assumed, or could not answer. The receiving stage is the gate: it may accept, reject, or send the run backwards when evidence invalidates earlier work.

**Authority is placed where it can be enforced, and reported where it cannot.** A protected or gitignored path is refused before the tool call runs, because a secret that has been read cannot be unread — that is the one boundary pi-crust can enforce soundly, since a tool call belongs to the agent that made it. Everything else is observed afterwards and reported: `writes:` per agent is checked against the filesystem after every call, and what an Activity changed without reporting is named for you. Nothing is ever put back. A developer working in the same branch is indistinguishable from an agent in a diff, and guessing wrong destroys work that was never committed. The reviewer agent is still not allowed to fix what it was asked only to judge, and a commit carries only what the Activity was observed to change — never the rest of your working tree.

**State is external.** The trace database and the handoff directory outlive the session, so "where did this stop and why" is answered from data, by you or by an agent, hours later. It is resumable. You can branch from an Activity Run into a new session to steer into an alternate set of deliverables.

## What

### The SDLC stages

| Stage             | Activity                                                                            |
| ----------------- | ----------------------------------------------------------------------------------- |
| 1.1 Evaluate      | `scout`                                                                             |
| 1.2 Identify      | `identify`                                                                          |
| 1.3 Conceptualize | `conceptualize`                                                                     |
| 2.1 Plan          | `plan`                                                                              |
| 2.2 Design        | `design`                                                                            |
| 2.3 Build         | `test-tdd` or `test`, `build` — and the `checks` gate, which runs your own commands |
| 3.1 Verify        | `review`, `code-review`                                                             |
| 3.2 Launch        | `document` + a human; an Activity with `commit: true` lands its own change          |

An Activity is named for the work and IS its agent: one entry in `crust.activities.yaml` says who performs it (model, tools, writes, prompts) and what the work is (`output`, `attempts`, `commit`). Add an entry and it is runnable; delete one and the capability is gone. Nothing in the package holds a list of them. The engine derives [output checks](references/config.md#output-checks) from what each Activity reports.

### Other Activities

The lifecycle above is a structured set of Activities. The registry ships more, and you can run any combination in any order — or add your own.

**Research, when the problem is that nobody knows yet.** Each discipline establishes what is true in its own subject and decides nothing — "find out" and "decide" are different jobs, and a stage asked to do both will quietly do the second while appearing to do the first.

| Activity             | Establishes                                                   |
| -------------------- | ------------------------------------------------------------- |
| `technical-research` | what is technically true, feasible, and supported by evidence |
| `domain-research`    | an accurate model of the domain and the rules that govern it  |
| `ux-research`        | what users need, experience, understand, and struggle with    |
| `security-research`  | how this could fail, be misused, or be attacked               |
| `data-research`      | what the empirical evidence says, and what it cannot say      |

**The rest.**

| Activity    | For                                                                                                            |
| ----------- | -------------------------------------------------------------------------------------------------------------- |
| `diagnose`  | reproducing a reported behaviour and naming its cause, with evidence. The first Activity of `bugfix`           |
| `ux-design` | turning validated needs into an interface specification somebody can implement. Decides, so it is not research |
| `document`  | writing up what the diff shows, from the run's own baseline                                                    |
| `gh-issue`  | opening one GitHub issue carrying a discovery chain's findings; changes nothing in the repository              |

Two more are **Planners** rather than Activities: `operator` chooses the chain and runs it in the same trace, `triage` chooses the same chain and hands it back as a command. A Lifecycle cannot name either — they are what chooses a Lifecycle — and configuration can tune them but never add a third.

### Running one

These run in a repository pi-crust has been stamped into: `bun <pi-crust>/scripts/install.ts` from that repository's root writes `.pi-crust/` and the `just crust` recipes.

```bash
just crust please                          # answer questions, get the command
# your own models/colours: cp <pi-crust>/cookbooks/examples/crust.config.local.example.yaml \
#                             .pi-crust/config/crust.config.local.yaml
just crust help                            # every recipe and flag, plus the above
just crust list                            # every Lifecycle and Activity this repo offers
just crust run "<...>" --lifecycle sdlc    # the whole lifecycle, nine agent calls
just crust run "<...>" --lifecycle bugfix  # a reported bug, from symptom to fix
just crust run "<...>" --activities plan,test,build
just crust run "<...>" --activities plan,build,review+code-review   # + runs at once
just crust operator "<...>"                # it chooses the chain, then runs it
just crust run "<...>" --activities code-review --scope apps/gateway
just crust report <run-id>                 # where it got to, and what finishes it
```

Useful flags: `--scope` (a ref, a range, a directory, or a glob — what the judging Activities judge), `--approve-after identify,design` (stop for you after those stages), `--commit false` (land nothing; committing is otherwise declared per Activity), `--resume` with `--run-id`, `--handoff specs/{session_id}` (move where this run's documents go), `--name "payments rewrite"` (a label shown instead of the lifecycle).

### Getting the most out of it

**Match the chain to the uncertainty.** `sdlc` is deliberately expensive: it buys success criteria written before anyone builds, a logical model decided before a schema settles it, and a reviewer with something other than its own opinion to rule against. Work whose shape you already know does not need that, and `compose` exists so you do not pay for stages you do not want.

**Gate the decisions that are expensive to get wrong.** `--approve-after` is opt-in and the run exits rather than blocking, so a gate costs you nothing until you answer it. Two escalations happen without being asked for: a consequential unresolved question, and a second regression to the same stage.

**Read the plan before the build runs.** `just crust run "<...>" --activities plan` then `just crust run "<...>" --run-id <id> --activities build` is cheaper than discovering a bad plan at review.

**Declare your checks.** `routing.checks` is where the `checks` gate gets its commands, and a path that matches no rule fails rather than passing quietly. The convention checkers belong here: a violation caught by a command costs nothing, and the same violation caught by a reviewer costs a build-sized call.

**Expect it to stop.** Waiting is a state, not a failure. So is a regression. A run that stops and tells you why has done its job better than one that guessed. You can override this with `--trust-level 100` (or `--trust-level high`), in which case it will use it's judgement and tell you what decisions it made on your behalf at the end of each Activity.
