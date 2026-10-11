# DAG refactor: the work, and what is settled

The task list for [REFACTOR_DAG.md](REFACTOR_DAG.md). That document says what the architecture should be; this one tracks what is left and what has already been decided, so the work survives a compaction without the decisions being relitigated.

Each task names what proves it. A task is done when its evidence exists, not when the code looks right.

## Where this stands

[REFACTOR-OPEN-CLOSED.md](REFACTOR-OPEN-CLOSED.md) is complete: Activities, Lifecycles and themes are configuration, the runtime left the stamp, and a team's work survives an update. That refactor delivered the *vocabulary and the configuration* for a DAG. It did not deliver the DAG.

Of the nine orchestration criteria in REFACTOR_DAG.md, one is met — cycles are rejected, at load. Nothing executes concurrently, the Stage does not survive loading, there is no Stage Gate, and a Context Envelope still carries exactly one upstream result.

## Settled decisions

These were argued and agreed. Do not reopen them without new evidence.

### A Stage declares how its Activities run

```yaml
stages:
  - name: discover
    strategy: serial
    activities: [identify, conceptualize]

  - name: accept
    strategy: concurrent
    activities: [review, code-review]
```

`strategy` defaults to `serial`, so a file that does not mention it keeps today's behaviour exactly. A serial Stage is a *sequence*, which is what keeps Stage counts low — without it, every dependent pair needs its own Stage.

`concurrent` is an explicit independence claim somebody made, rather than an accident of which Activities were listed together. The shipped groupings today are not independence claims, which is the defect task 2 fixes.

### Stages run in the order they are declared

`depends_on` is removed. A Stage depends on the Stage before it, and nothing else.

This forecloses one shape: **parallel branches of unequal length** — a one-Activity branch running alongside a two-Activity branch. Collapsing those into a concurrent Stage would be wrong, because it would also run the two dependent Activities concurrently. That shape is not needed today, and re-introducing `depends_on` later is backward-compatible, since "omitted means the previous Stage" stays true for every file written in the meantime.

### An Activity declares what it produces

| Today   | Meaning          | Becomes                        |
| ------- | ---------------- | ------------------------------ |
| omitted | writes anywhere  | **validation error**           |
| `[]`    | handoff only     | `writes: ['context_handoff/']` |
| `[...]` | only these paths | unchanged                      |
| —       | —                | `writes: ['*']` for anywhere   |

Silence currently grants the most dangerous permission, which is the wrong default to inherit. Stating `context_handoff/` also lets a team send findings somewhere else — `specs/` — which they cannot say today.

This is not ergonomics. It is what makes concurrent writes possible at all: see the defect below.

### A concurrent Stage requires disjoint declared paths

Validation rejects a `concurrent` Stage whose Activities declare overlapping paths. `'*'` overlaps everything, so an Activity declaring it can never share a concurrent Stage.

### Gates exist at both levels

`--approve-after` takes Activity names, and Stage names prefixed with `stage:`:

```bash
--approve-after plan,stage:accept
```

| Where the gate is named | Stage strategy | When the run pauses                         |
| ----------------------- | -------------- | ------------------------------------------- |
| an Activity             | serial         | as soon as that Activity completes          |
| an Activity             | concurrent     | after every Activity in the Stage completes |
| `stage:<name>`          | either         | after every Activity in the Stage completes |

An Activity gate inside a concurrent Stage is *recorded* when the Activity finishes and *enforced* at the Stage boundary. In-flight siblings run to completion — nothing is killed mid-flight — and the pause names the Activity that raised it, not the Stage.

## The defect that blocks concurrency

`enforce-permissions.ts` attributes writes by snapshotting the working tree before an Activity runs and diffing it afterwards. Under concurrency that is wrong, not merely imprecise: if two Activities run together, each one's diff contains the other's writes, so both fail for work they did not do — and the reversion path could discard it.

Attribution has to move from *interval* to *path*: did anything land outside the union of declared paths, and did anything land inside another Activity's declared paths. That is only possible because every Activity will declare what it produces, which is why task 3 precedes task 7.

A write that lands outside every declared path during a concurrent Stage still cannot be attributed to an author. Fail the Stage and name the paths; do not guess.

## Tasks

| #   | Task                                    | Done when                                                                                                                                  |
| --- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Stage strategy in the schema            | `strategy` parses, defaults to serial, and an unknown value is rejected                                                                    |
| 2   | Re-cut the shipped lifecycles           | Every `concurrent` Stage holds Activities that are genuinely independent; serial order is unchanged from today                             |
| 3   | `writes` redesign                       | `'*'` parses, omission is an error, the shipped registry states `context_handoff/`, and existing behaviour is unchanged for explicit lists |
| 4   | Disjointness validation                 | A concurrent Stage with overlapping declared paths is refused at load, naming both Activities                                              |
| 5   | Path attribution in enforce-permissions | A breach is detected without reference to when the Activity ran; the existing `git checkout` reversion case still fails                    |
| 6   | The Stage survives loading              | The executor receives Stages, not a flat list; a serial plan reproduces today's trace exactly                                              |
| 7   | The scheduler                           | Independent Activities run concurrently; dependent ones wait; a fully serial lifecycle is byte-identical in trace to today                 |
| 8   | Context composition                     | An Activity with several upstream results receives all of them with provenance; conflicting findings are reported, not merged              |
| 9   | Gates at both levels                    | The four rows of the gate table each have a test                                                                                           |
| 10  | Run states                              | Blocked, skipped and cancelled are distinguishable in the trace from failed                                                                |
| 11  | Trace vocabulary                        | Decide whether `phase` migrates to Activity Run; if yes, with a data migration — see REFACTOR_DAG.md                                       |
| 12  | Documentation                           | No document describes the serial engine as current                                                                                         |

Order matters: 1–2 make the configuration honest, 3–5 make concurrent writes safe, 6–8 build the executor, 9–10 complete the semantics.

## Known leftovers, not blocking

`web_search` and `web_fetch` are named by six Activities each and do not exist in pi — pi 1.1.0 ships `bash`, `edit`, `find`, `grep`, `ls`, `read`, `write`. Deferred deliberately.
