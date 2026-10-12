# Create a Lifecycle

A Lifecycle is configuration, not code. It lives in `.pi-crust/config/crust.lifecycles.yaml`, names Activities the registry already defines, and arranges them into Stages. There is no script to write.

## Step 1 — Decide the Activities, in order

Pick from `crust.activities.yaml`. A Lifecycle names Activities; it does not define them. If the work needs an Activity the registry does not have, add it there first — see [create_config.md](create_config.md).

Order is the order of the work: find out, decide, do, check.

## Step 2 — Group them into Stages

A Stage is a progression step. It holds Activities and says how they run:

```yaml
lifecycles:
  - name: quick
    description: Plan it, build it, and check it still compiles.
    stages:
      - name: deliver
        activities: [plan, test, build]
```

`strategy` defaults to `serial`, which means the Activities run one after another in the order listed. A serial Stage is a **sequence**, so a chain of dependent work is one Stage rather than one Stage per Activity — the three above are one Stage for exactly that reason.

The shipped `sdlc` is cut the same way: `discover`, then `deliver` holding plan through build, then `accept`. Three Stages for eight Activities, because only two boundaries in that chain are real progression points.

Stages run in the order they are declared. There is no `depends_on`: a Stage depends on the Stage before it.

## Step 3 — Claim concurrency only where it is true

```yaml
      - name: accept
        strategy: concurrent
        activities: [review, code-review]
```

`concurrent` is a claim, not a grouping. It says these Activities can run against the same working tree at the same time without reading each other's half-finished work.

It is checked rather than trusted. A concurrent Stage whose Activities declare overlapping `writes` is **refused at load**, naming both Activities and the paths that collide. An Activity declaring `['*']` overlaps everything and can never share a concurrent Stage.

The test is not "could these run in either order" — it is "can these run at the same moment". A reviewer and a code-reviewer both read the finished diff and each writes only its own findings file, so neither can observe the other's work in progress. A tester and a builder cannot: the builder is supposed to read what the tester wrote.

When in doubt, leave it serial. The cost is wall-clock time; the cost of being wrong is a race nobody can reproduce.

## Step 4 — Run it

```bash
just crust compose "the request" --lifecycle quick
```

It also appears in `just crust please` automatically, above the individual Activities.

## What a Stage gives you beyond ordering

A Stage is addressable. `--approve-after stage:accept` stops the run after that Stage, and an Activity gate inside a concurrent Stage is lifted to the Stage boundary so its siblings are never cut off mid-write. See the gate table in [../references/config.md](../references/config.md).

## Checklist

- Every Activity named exists in `crust.activities.yaml`
- Stage names are unique within the Lifecycle — a gate naming a duplicate would be ambiguous, and it is refused
- No Activity appears twice in one Stage
- Every `concurrent` Stage holds Activities that could run at the same moment, and whose declared paths are disjoint
- The Lifecycle loads: run it, or run `just crust please` and see it listed
