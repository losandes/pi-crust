# Backend review — judgement questions

Load only when the change touches `data/`, `use-cases/`, `routes/`, or `middleware/`. The automated checks in Step 3 already cover mutation, composition helpers, `try`/`catch` placement, `Promise.all`, and parameter immutability. What follows is what they cannot see.

Rules live in [backend-domains-design-brief.md](../../adr/project-organization/backend-domains-design-brief.md) and [functional-conventions.md](../../adr/typescript/functional-conventions.md). Quote those, not this file.

## Layering

- Is the module in the layer its behaviour belongs to? A `data/` module that decides *whether* to act is a use case wearing the wrong name, and a use case that opens a connection is data access.
- Does the use case receive its data, or fetch it? The direction is one way.
- Does a route contain logic that a use case should own? A route translates transport to domain and back.

## Naming

- Does the filename name the behaviour — `resolve-…`, `write-…`, `delete-…`, `perform-…` — or a technical noun like `helpers` or `utils`?
- Does the domain folder name a business concept, or a technical layer?
- One behaviour per file. A file spanning several behaviours will not be caught by any linter and is the most common structural finding here.

## Data access

- Is the query raw SQL in a tagged template, with the shape documented in a sibling `.dbcnb`?
- Is every row parsed with a schema before becoming a typed value? An inferred type is a claim about the query, not a guarantee about the data.
- Are parameters bound rather than interpolated? String-built SQL is a blocking finding regardless of whether the input looks trusted today.
- Does the query group or join on a column that is functionally dependent on another? That splits one logical row into several when the dependent value changes upstream.

## Errors and settlements

- Does the module return a settlement rather than throwing for an outcome it anticipated?
- If it produces a batch settlement, does the caller inspect `hasIssues`? A measured failure margin that nobody reads is the same as swallowing it.
- Are multiple failures aggregated into a `CompositeError` rather than joined into a string?

## Concurrency

- If work is fanned out, is every item processed and the failure margin reported?
- Is a `Promise.all` suppression genuinely a fixed tuple where every value is required, or a batch wearing a suppression?

## Data and schema

- Does a new table follow the identifier rules for its role — entity keys and fact keys are chosen differently?
- Does a mutation that changes durable state write an audit row in the same statement, with an actor?
