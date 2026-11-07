---
Context: Frontend apps
---

# Generate routes from the pages directory

## Status

accepted

## Decision

Routes are derived from the file system. A page is a `.tsx` file whose default export is the page component; its path in the pages directory is its URL.

```text
pages/about/index.tsx                  → /about
pages/products/index.tsx               → /products
pages/products/featured/index.tsx      → /products/featured
pages/products/[product-id]/index.tsx  → /products/:productId
```

Bracketed segments become route parameters, converting kebab-case to camelCase.

Pages are collected at build time:

```ts
import.meta.glob('./pages/**/*.tsx', { eager: true })
```

No manual route configuration for the common case. A route table is only written when a route cannot be expressed as a directory — for example an alias or a redirect from a retired URL.

## Context

- **What problem**: a hand-maintained route table is a second source of truth. It drifts from the components it names, and a new page is not reachable until someone remembers to register it. The failure is silent in development and visible only as a 404.
- **Why the file system**: the directory already encodes the hierarchy. Deriving routes from it means the URL structure is legible from the tree, which matches how we name everything else — for the behavior produced, not the mechanism.
- **Constraint**: the glob is resolved at build time, so routes are static. A genuinely dynamic route set — one determined by data at runtime — is out of scope for this mechanism and needs an explicit table.
- **Alternatives considered**: (a) a central route module — rejected, it is the drift problem above; (b) a framework that owns routing end to end — rejected for now, it constrains build tooling more than we want; (c) decorators or a registry populated at import time — rejected, it makes route discovery depend on module side effects.

## Consequences

**Easier**

- Adding a page is adding a file. Nothing else to update.
- URL structure is readable from the directory tree.
- Dead pages are dead files, so removing one cannot leave an orphaned route.

**Harder**

- Directory names are now user-visible URLs, so renaming a folder is a breaking change to consumers and must be treated as one.
- Eager globbing loads every page module at startup. Large applications will need lazy variants, which trades startup cost for a suspense boundary per route.
- The kebab-to-camel conversion is a convention a reader must know; the mapping is not visible at the call site.

**If we reverse this**

Reversal is mechanical: enumerate the resolved routes and write them to a table. The pages keep their default exports either way.
