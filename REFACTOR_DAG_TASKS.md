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

All twelve are delivered. What each one actually does, and what proves it:

| #   | Task                          | Evidence                                                                    |
| --- | ----------------------------- | --------------------------------------------------------------------------- |
| 1   | Stage strategy in the schema  | `strategy` parses, defaults to serial, an unknown value throws              |
| 2   | Re-cut the shipped lifecycles | `accept` is the only concurrent Stage; serial order is unchanged            |
| 3   | `writes` redesign             | required, `'*'` for anywhere, `{handoff}` for the run's directory           |
| 4   | Disjointness validation       | a concurrent Stage with overlapping paths is refused at load, naming both   |
| 5   | Path attribution              | a sibling's declared path is the sibling's, not this Activity's breach      |
| 6   | The Stage survives loading    | the engine receives Stages; `--steps` becomes the one serial Stage it meant |
| 7   | The scheduler                 | observed interleaving for concurrent, observed sequence for serial          |
| 8   | Context composition           | `upstream` carries every result with its Activity; disagreement is reported |
| 9   | Gates at both levels          | all four rows of the gate table have a behavioural test                     |
| 10  | Run states                    | `blocked` and `cancelled` events name what the run did not reach            |
| 11  | Trace vocabulary              | decided: **no migration** — see below                                       |
| 12  | Documentation                 | config reference, observability, and both lifecycle cookbooks rewritten     |

### Why `phase` stays

`phase` already means Activity Run. There is a `phases` table, a `phase_id` on every event, `phase_start` and `phase_end` event types, and **24 non-test files** read it. Adopting the DAG's word would be a schema migration against databases that already hold runs, for a vocabulary improvement with no behavioural consequence.

The cost lands on existing traces, which are the one artifact nobody can regenerate. Left alone deliberately, not overlooked.

### What a Stage still does not do

Stages are a chain. Two Stages cannot run at the same time as each other, so parallel branches of unequal length — a one-Activity branch running alongside a two-Activity branch — cannot be expressed. Concurrency lives strictly inside a Stage.

Re-introducing `depends_on` is the way to lift that, and it stays compatible with every file written in the meantime because "omitted means the previous Stage" would remain true of all of them. Nothing has needed it yet.

## Known leftovers, not blocking

`web_search` and `web_fetch` are named by six Activities each and do not exist in pi — pi 1.1.0 ships `bash`, `edit`, `find`, `grep`, `ls`, `read`, `write`. Deferred deliberately.
