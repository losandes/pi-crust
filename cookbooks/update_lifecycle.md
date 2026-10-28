# Update a Lifecycle

Change `.pi-crust/config/crust.lifecycles.yaml`. Nothing is generated from it and no script mirrors it, so the file is the whole change.

## Add an Activity to a Stage

```yaml
      - name: implement
        activities: [test, build]
```

In a serial Stage, position is execution order. The Activity must exist in `crust.activities.yaml`; a name the registry does not have is dropped when the plan is built, which is silent — so check the registry rather than the run.

## Add a Stage

Insert it where it belongs in the list. Stages run in declaration order, so moving a Stage up moves the work.

## Make a Stage concurrent

```yaml
      - name: accept
        strategy: concurrent
        activities: [review, code-review]
```

Before doing this, answer one question: **can these Activities run at the same moment, against one working tree, without reading each other's half-finished work?** Not "are they independent of each other's conclusions" — whether one can observe the other mid-write.

The load-time check enforces the mechanical half of that. If the Activities' declared `writes` overlap, the Lifecycle is refused and names the pair. It cannot enforce the judgement half: two Activities with disjoint paths can still be a sequence in disguise, and `concurrent` would run them out of order every time.

## Make a concurrent Stage serial again

Delete the `strategy` line. `serial` is the default, and a serial Stage runs its Activities in the order listed.

This is always safe. The reverse is not.

## Split one Stage into two

When part of a Stage must be gated separately, or must not run concurrently with the rest:

```yaml
      - name: implement
        activities: [test]
      - name: deliver
        activities: [build]
```

Splitting changes nothing about execution order in a serial chain — the Activities run in the same sequence either way. What it changes is what `--approve-after stage:<name>` can address, and what a reader understands the progression to be.

## Replace a Lifecycle on your own machine

`crust.lifecycles.local.yaml` beside the committed file is gitignored and yours. Naming a Lifecycle there **replaces** the team's outright, rather than merging into it: a Lifecycle is a graph, and splicing one of your Stages into somebody else's by name produces an arrangement neither of you wrote. Copy the team's and edit it.

A name the team file does not have is simply a new Lifecycle. See `crust.lifecycles.local.example.yaml`.

## What the loader refuses

Both files are validated together, before anything runs:

| Refused                                       | Because                                                                       |
| --------------------------------------------- | ----------------------------------------------------------------------------- |
| two Stages with one name                      | `--approve-after stage:<name>` could not say which it meant                   |
| one Stage naming an Activity twice            | concurrently that is an Activity racing itself                                |
| a `strategy` that is not serial or concurrent | a typo falling back to serial is a Stage you believe is concurrent and is not |
| a concurrent Stage with overlapping `writes`  | the two would overwrite each other and neither could be held responsible      |

Discovering any of these three Activities into a run wastes the three, which is why they are load-time and not run-time.
