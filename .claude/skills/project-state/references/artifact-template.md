# Artifact structure

Use this shape where it applies. Omit sections with nothing in them. It is a guide, not a schema — optimise headings for human comprehension *and* for later selective retrieval through context-mode, which returns sections rather than whole files.

```markdown
# <Body of Work>

- **Owner:** <name or handle>
- **Project:** <project>
- **Year:** <year>
- **Last updated:** <YYYY-MM-DD>

## Objective

A concise description of what this body of work is trying to accomplish.

## Active Work

### <work item>

- **Goal:** ...
- **State:** ...         # what is true now, not what was done
- **Branch:** ...        # only when unmerged work must be resumed from it
- **PR:** ...            # the pointer and why it matters, never its diff stats
- **Issues:** ...        # what the issue establishes, not that it was filed
- **Relevant areas:** ...
- **Next:** ...

## Decisions

### <decision>

- **Decision:** ...
- **Rationale:** ...
- **Affects:** ...

## Discoveries

### <discovery>

- **Finding:** ...
- **Implication:** ...

## Known Problems

### <problem>

- **Problem:** ...
- **Current understanding:** ...
- **Status:** ...
- **Next:** ...

## Open Questions

- ...

## Rejected / Failed Approaches

### <approach>

- **Approach:** ...
- **Why rejected:** ...
- **Relevant when:** ...

## Constraints

- ...                    # invariants and observed external behaviour
                         # that future work must not violate

## Recently Completed

- ...                    # only what a reader must know is already true, so
                         # they do not redo it; not a changelog
```

The metadata block is required and must agree with the path. For `.context/project-state/2026/authorization/developer-a/resource-permissions.md`, `Owner` is `developer-a`, `Project` is `authorization`, and `Year` is `2026`.

Every section is subject to [retention.md](retention.md). Sections are cheap; lines are not. A heading with one durable entry is better than a heading padded with activity to look complete.

A conforming instance: [example-artifact.md](example-artifact.md).
