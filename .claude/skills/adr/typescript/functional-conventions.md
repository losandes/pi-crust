# Functional Conventions

## Status

accepted

How we apply functional programming in TypeScript. These are decisions, not a tutorial. Background on the underlying ideas is in [references/mostly-adequate-notes.md](./references/mostly-adequate-notes.md) — read it to learn a concept, not to follow a rule.

Scope: purity, composition, immutability, and error propagation. File naming and layer structure are covered in the backend and frontend conventions.

## 1. Dependencies first, data last, curried

Inject dependencies and fixed context in the first call; take the varying data in the last. Partial application becomes natural and call sites stay free of plumbing.

```ts
export const resolveThingByKey =
  ({ db, logger }: Pick<TContext, 'db' | 'logger'>, key: string) =>
  async (scope: string): Promise<TSettlement<TThing | null>> => { ... }
```

Destructure the context to exactly what the function uses. A parameter typed `Pick<TContext, 'db' | 'logger'>` declares its dependencies; one typed `TContext` hides them and makes the function harder to test.

## 2. Return results; don't throw for expected outcomes

Expected failures — not found, invalid input, upstream rejection — are values. Reserve `throw` for programmer error and unrecoverable startup failures.

This gives every layer one job. Data access and use cases return settlements and never throw for an outcome they anticipated. A single error boundary at the edge — middleware, or the transport handler — catches what is left, which by definition is a defect rather than a condition. Do not add `try`/`catch` at every layer: an intermediate catch either swallows a defect or re-throws it, and both are worse than letting it reach the boundary that knows how to format it.

A settlement is a discriminated union on `status`, so the compiler forces both branches to be handled:

```ts
type TSettlement<TData, TError = Error> =
  | Readonly<{ status: 'ok'; data: TData }>
  | Readonly<{ status: 'error'; error: TError }>
```

These are defined once and imported — do not declare a result shape per package:

```ts
import {
  CompositeError,
  safeParsePaginatedSettlement,
  safeParseSettlement,
  safeParseSettlementsArray,
  type TPaginatedSettlement,
  type TSettlement,
  type TSettlementsArray,
} from '@workspace/typedefs'
```

Batch and paginated variants additionally carry the failure margin, so a partially successful operation can succeed while reporting what did not:

```ts
Readonly<{
  status: 'ok'
  data: TData[]
  hasIssues: boolean
  issues: unknown[]
}>
```

See [settle-all-tasks-and-measure-failures.md](./settle-all-tasks-and-measure-failures.md) for how the margin is reported.

Aggregate multiple failures into a `CompositeError` rather than concatenating messages into a string.

We do **not** use `Maybe`, `Either`, or `Task`. Discriminated unions plus schema validation cover the same ground with less machinery.

## 3. Parse at the boundary

Anything crossing a trust boundary — database rows, HTTP responses, environment variables, request bodies — is validated with zod before it becomes a typed value. Never cast untrusted data into a type.

```ts
const parsed = thingSchema.safeParse(row)

return parsed.success
  ? { status: 'ok', data: parsed.data }
  : { status: 'error', error: new Error(parsed.error.message) }
```

An inferred type is a claim about the query or the contract, not a guarantee about the data that arrived.

## 4. Pure core, effects at the edges

I/O lives in the data-access layer. Business logic is pure and receives what it needs as arguments. Keep the direction one way: use cases are given data, they do not fetch it.

A function that accepts `Pick<Request, 'path'>` rather than `Request` is testable with an object literal. That is the point of the constraint.

## 5. Immutability

- `Readonly<T>` and `readonly T[]` on exported types and parameters
- Build new values with spread; never mutate an argument
- No `as any`, no non-null `!`

`const` and immutable construction are the default. Local `let` is an **exception that has to earn itself**, not a fallback when the functional form takes a moment longer to write.

The bar: the immutable version is *comprehensibly* more complex, to a *meaningful* degree. Marginally longer does not qualify. Slightly less elegant does not qualify. The reader having to hold materially more in their head does.

It qualifies when all of these hold:

1. The mutation cannot escape the function — no caller can observe it
2. The algorithm is genuinely stateful, such as coordinating concurrent workers over a shared cursor, or accumulating into a preallocated slot by index
3. The immutable alternative obscures the algorithm rather than merely lengthening it

```ts
// Acceptable — workers share one cursor by design; expressing this
// immutably would mean simulating shared state, which reads worse
const results = new Array<R>(items.length)
let cursor = 0
```

These do **not** clear the bar:

```ts
// No — accumulation is what reduce is for
let total = 0
for (const item of items) { total += item.count }

// No — building a collection
const names = []
for (const p of people) { if (p.age >= 18) names.push(p.name) }
```

### `try`/`catch` is not a licence to reassign

`try`/`catch` is a statement, so `const x = try {...}` cannot be written. This produces declare-then-assign:

```ts
// Avoid
let hostname: string
try { hostname = new URL(url).hostname }
catch { return { status: 'error', reason: 'invalid_url' } }
```

That is a real language constraint, not laziness — but "Return results; don't throw for expected outcomes" already answers it. Wrap the throwing call in a helper that converts it to a settlement:

```ts
import { safeParseSettlement } from '@workspace/typedefs'

const parsed = safeParseSettlement(() => new URL(url))
if (parsed.status === 'error') return { status: 'error', reason: 'invalid_url' }
const { hostname } = parsed.data
```

Third-party APIs that throw are where a settlement earns its keep. Wrap them once, at the edge, rather than threading `let` through the function body.

## 6. Composition over loops — with judgment

Prefer `map`/`filter`/`reduce` and small composed functions to imperative loops. Stop short of point-free code that obscures intent. A named intermediate variable is usually worth more than a shorter pipeline.

## 7. Utility libraries

`ramda` is available and useful — reach for it before hand-writing a utility like `compact`, `pluck`, or `groupBy`. It is **not** mandatory, and it is not a replacement for native array methods. `xs.map(f)` is clearer than `R.map(f, xs)` and needs no import.

Do not hand-roll `curry`, `pipe`, or `compose`. If you need them, import them.
