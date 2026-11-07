# Where artifacts live, who owns them, and how to find them

## The path

Project-state artifacts are committed to the repository so they can be shared. Use this structure unless the repository has established another:

```text
.context/
  project-state/
    <year>/
      <project>/
        <owner>/
          <artifact-name>.md
```

For example:

```text
.context/
  project-state/
    2026/
      authorization/
        developer-a/
          resource-permissions.md
          workos-migration.md
        developer-b/
          integration.md
      video/
        developer-a/
          multi-media-episodes.md
        developer-c/
          transcoding.md
```

The path encodes four dimensions:

> **Year = organizational scope → Project = relevance scope → Owner = provenance → Artifact = knowledge scope**

## Year

Calendar year is the primary organizational boundary, because annual planning commonly defines a meaningful boundary between bodies of organizational work.

Year is a **default retrieval scope, not a knowledge boundary**. When working on a current-year project:

- begin discovery with the current year's artifacts for that project;
- consult prior years when project continuity, references, or retrieval results suggest older knowledge may still apply;
- do not assume a decision, constraint, discovery, or unresolved problem stopped being relevant because the calendar changed;
- when prior-year knowledge becomes materially relevant, synthesise it into the current owner's current-year artifact rather than editing or mechanically copying the historical one.

Knowledge flows forward through synthesis; historical artifacts remain a representation of what their owner knew at the time.

Do not introduce months or quarters into the directory hierarchy. Put dates inside the artifact when finer chronology matters.

## Project

The body of organizational work the artifacts belong to. Names are semantic and recognizable, not incidental to an implementation or a calendar.

| Prefer | Over |
|---|---|
| `authorization/` | `sprint-42/` |
| `video/` | `q4-work/` |
| `adstack-modernization/` | `pr-184/` |

Projects are useful discovery boundaries, not absolute ones. Relevant knowledge may sit in another project or an earlier year.

## Owner

Every artifact has exactly one owner — a stable name or handle identifying the person maintaining it. The owner may create, update, reorganize, or retire their own artifacts.

**Do not edit another person's artifact.** These files are shared through Git but are not collaboratively authored documents. Single ownership is what stops several developers and agents rewriting one state file into a permanent merge conflict. Anyone may read or index another owner's artifact whenever its context is relevant.

## Artifact

An artifact is an independently useful body of knowledge within a project. Name it for the work, not for the session, branch, PR, date, sprint, month, or quarter that happened to produce it.

| Prefer | Over |
|---|---|
| `2026/authorization/developer-a/resource-permissions.md` | `2026/authorization/developer-a/session-2026-10-01.md` |
| `2026/video/developer-b/hls-delivery.md` | `2026/video/developer-b/pr-184.md` |

Split into a new artifact when the knowledge has a meaningfully independent scope or lifecycle — not merely because the work continued in another session, branch, PR, sprint, or calendar period.

## Working across years

A new calendar year does not invalidate existing knowledge.

1. Create new artifacts under the new year as new work occurs.
2. Treat prior-year artifacts as historical source material.
3. Retrieve them selectively, when current work depends on their decisions, discoveries, constraints, unresolved problems, or implementation history.
4. Carry materially relevant knowledge forward by synthesising it into the current owner's current-year artifact.
5. Do not mechanically copy last year's artifact into this year.
6. Do not edit the historical artifact to make it look current.

```text
.context/project-state/
  2026/authorization/developer-a/resource-permissions.md     # stays intact
  2027/authorization/developer-a/authorization-evolution.md  # may incorporate its decisions
```

Year should improve discovery, not create temporal amnesia.

## Handoffs

When another developer's artifact is supplied as a source:

- treat it as synthesised evidence about the work, not as fact beyond question;
- preserve the useful decisions, discoveries, constraints, known problems, and unresolved questions;
- **do not modify their artifact**;
- integrate into the receiving developer's artifact only what is needed;
- distinguish inherited knowledge from assumptions introduced during new work, where that distinction matters.

```text
.context/project-state/2026/authorization/developer-a/resource-permissions.md
                                      │
                                      │ source / handoff
                                      ▼
.context/project-state/2026/authorization/developer-b/resource-permissions.md
```

A handoff should not require the receiving developer to load every historical session or reconstruct the project from GitHub and Slack. The artifact must carry enough semantic context to explain why each important reference and decision matters.

## Discovery without loading everything

`.context/project-state/` is itself a catalog of available organizational memory. Answer "does anyone have context on X?" from the catalog, cheaply, before ingesting anything.

Progressive discovery, in order:

1. List the current year's relevant project directory.
2. Identify which owners and artifacts exist.
3. Inspect filenames and lightweight metadata — the `#` heading and the metadata block — before reading any artifact in full.
4. Read only the artifacts likely to be relevant.
5. Reach into prior years when continuity or the question suggests older knowledge matters.
6. Expand into other projects only on evidence that their knowledge intersects.

So "does anyone already have context on authorization?" is answered by discovering the authorization artifacts and their owners — not by assuming there are none, and not by loading the whole tree. Narrow the retrieval space before inference.
