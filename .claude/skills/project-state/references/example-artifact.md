# Resource Permissions

- **Owner:** developer-a
- **Project:** authorization
- **Year:** 2026
- **Last updated:** 2026-03-11

> Illustrative only. A real artifact of this shape would live at `.context/project-state/2026/authorization/developer-a/resource-permissions.md`.

## Objective

Replace organization-wide role checks with permission evaluation at the level of an individual resource instance, so a user can hold different permissions on two resources inside the same organization.

## Active Work

### Converting call sites to instance-level evaluation

- **Goal:** Every authorized request evaluates `(subject, action, resource instance)`, and the organization role helper is deleted.
- **State:** Read paths converted; write paths still call the old helper. Shipped behind the `resource_permissions` flag, enabled in staging only. Both paths must stay correct until the flag is removed.
- **PR:** #184 — the read-path conversion, and the worked example to copy for the write paths. Unverified whether it has merged since.
- **Issues:** #179 holds the write-path conversion.
- **Next:** Convert the write paths, then resolve the two unmapped legacy roles below — the helper cannot be deleted before that decision exists.

## Decisions

### Authorize at the resource instance, not the organization

- **Decision:** Permissions are evaluated against a specific resource instance.
- **Rationale:** Organization-level roles cannot represent permissions that differ between two resources in the same organization, which is the requirement that started this work. Revisit only if that requirement is withdrawn.
- **Affects:** The permissions schema, the evaluation cache key, and every former caller of the organization role helper.

### Migrate incrementally behind a flag

- **Decision:** Ship on the main line behind `resource_permissions` rather than on a migration branch.
- **Rationale:** A long-lived branch would conflict with resolver work already in flight.

## Constraints

- An evaluation result is only valid for one resource instance in one organization. Nothing may cache it more widely.
- Legacy organization roles are not a strict subset of the new model, so the migration is not a mechanical mapping.

## Known Problems

### List endpoints evaluate once per row

- **Problem:** Instance-level evaluation turns one role check per request into one per row.
- **Current understanding:** Suspected to be dominated by repeated policy loads rather than by evaluation itself. Not measured under production shapes.
- **Status:** Acceptable in staging; unvalidated for production volume.
- **Next:** Measure before optimising. Batch the policy load first; do not cache.

## Open Questions

- Two historical organization roles grant actions no resource-level permission expresses. Which team decides their fate? The old helper cannot be removed until this is settled.
- Does the audit log need the resource instance recorded, or is the action enough? Needs verification against the compliance requirement rather than assumption.

## Rejected / Failed Approaches

### Cache resolved permissions across organizations

- **Approach:** Memoise `(subject, action)` results globally to cut evaluation cost.
- **Why rejected:** Results depend on the resource instance and legitimately differ across organizations; the cache returned wrong answers in testing.
- **Relevant when:** Revisiting list-endpoint latency — any cache must be scoped to a single resource instance.

## Recently Completed

- The permissions schema and its backfill exist; read paths already use them. New work builds on that rather than reproducing it.
