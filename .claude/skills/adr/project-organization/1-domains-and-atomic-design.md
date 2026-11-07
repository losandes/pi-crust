---
Context: All apps (frontend examples)
---

# Use Atomic Design, Screaming Architecture (DDD), and Micro Frontends

- [Decision](#decision)
- [Prerequisites](#context-prerequisites)
- [Example](#context-example)
  - [Root folders](#root-folders)
  - [The Anatomy of a Package](#the-anatomy-of-a-package)
  - [Component Libraries](#component-libraries)
  - [Domains](#domains)
  - [The Anatomy of a Domain](#the-anatomy-of-a-domain)
  - [Usecases](#usecases)
  - [Pages](#pages)
  - [Complete Example](#complete-example)

## Status

accepted

## Decision

Use a [Screaming Architecture](https://8thlight.com/blog/uncle-bob/2011/09/30/Screaming-Architecture.html), in which we _segregate_ code into files named for the behaviors the code produces and _group_ files into domains.

## Context: Prerequisites

Are you familiar with the following? Even if you are, at least skim those links before continuing.

- [Domain-Driven Design (DDD)](https://en.wikipedia.org/wiki/Domain-driven_design)
- [Atomic Design](https://atomicdesign.bradfrost.com/chapter-2/)

From those readings, the following terms will be used throughout this document

- **Atoms**: foundational building blocks that comprise all our user interfaces (e.g. basic HTML elements like form labels, inputs, buttons, and others that can’t be broken down any further without ceasing to be functional)
- **Molecules**: relatively simple groups of UI elements functioning together as a unit (e.g. a form label, search input, and button can join together to create a search form molecule)
- **Organisms**: relatively complex UI components composed of groups of molecules and/or atoms and/or other organisms (e.g. a header organism that includes a search form molecule)
- **Templates**: page-level objects that place components into a layout and articulate the design’s underlying content structure (e.g. a homepage template that includes the header organism)
- **Pages**: specific instances of templates that with real representative content in place
- **Stages**: The 5 stages of Atomic Design: Atoms, Molecules, Organisms, Templates, and Pages
- **Domain**: the scope of responsibility for a microservice or micro frontend, emphasizing the separation of concerns between different parts of the application
- **Domain Components**: organisms and templates that are specific to a domain

## Context: Example

### Root folders

In the examples that follow, code will be added to `src` folders.

```shell
.
├── bin         # scripts and binaries
├── public      # static files that are references relative to root
└── src         # source code
    ├── domains # packages for business/product domains
    ├── layouts # page layouts (e.g. shell with headers and nav)
    ├── lib     # packages used across domains
    └── pages   # page composition and routes
```

- **src**: Code and markup for page composition and routing
- **src/lib**: Packages for Atoms, Molecules, Organisms, Domains, and Domain Components

### The Anatomy of a Package

Packages are added to the src/lib folder and each package follows open-source conventions for developing packages. So each package should look a lot like a package that we install from npm. The following example is for a package called "about".

```shell
.
└── src
    .
    └── lib
        └── about-dev
            ├── index.ts
            └── src
                ├── _components
                │   ├── ColorPalette.tsx
                │   ├── ColorSwatch.tsx
                │   ├── Styles.tsx
                │   └── About.tsx
                │
                ├── io
                │   ├── fetch-add-color-palette.ts
                │   └── fetch-color-palettes.ts
                │
                ├── state
                │   └── color-palette-store.ts
                │
                ├── typedefs
                │   ├── color-palette.ts
                │   └── color-swatch.ts
                │
                └── usecases
                    ├── add-color-palette.ts
                    ├── generate-palette.ts
                    └── get-color-palettes.ts
```

Each package will have:

- **index.ts**: a file the exports all of the public members of the package
- **src**: the source code for the package

Each package might have:

- **index.d.ts**: typings per package so developers can read about types in one place instead of opening every file in a package

Each package will omit:

- **package.json**: a dependency graph per domain; exports defined here

Why? Because React doesn't play well with microfrontend architectures unless you introduce a significant toolchain or ceremony, such as bit, or vite federation.

### Component Libraries

For the domain agnostic Atomic Design component libraries, we'll break each stage into it's own folder. Be disciplined in promoting unidirectional dependencies / avoid circular references.

- Molecules can depend on Atoms, but not vice versa.
- Organisms can depend on Atoms, Molecules, and other Organisms, but Atoms and Molecules should not depend on Organisms
- Templates can depend on any of these, Atoms, Molecules, and Organisms should never depend on Templates

```shell
.
└── src
    .
    └── lib
        └── _components
            ├── src
            │   ├── Buttons
            │   │   └── button
            │   ├── Cards
            │   │   └── ProductCard.tsx
            │   ├── Charts
            │   │   └── PieChart.tsx
            │   ├── Forms
            │   │   ├── FormField.tsx
            │   │   ├── search-form-store.ts
            │   │   └── SearchForm.tsx
            │   └── Inputs
            │       ├── input-store.ts
            │       └── Input.tsx
            └── index.ts
```

_Note the underscore prefix. This is simply to set component packages apart from code packages with a visual and sorting cue._

### Domains

Building on the definition from above:

> Domain-Driven Design (DDD): the scope of responsibility for a microservice or micro frontend, emphasizing the separation of concerns between different parts of the application

When using DDD, it often makes sense to structure projects and code to match the vocabulary associated with a scope of responsibility, such as a business department or domain, or a feature-set. It rarely makes sense to structure and code to match the frameworks we choose.[^1]

Given an e-commerce application in which companies sell products to people, we might have domains like, "companies", "people" (users, sellers, buyers, etc.), and "products".

Given the desire to implement the [Single Responsibility Principle](https://en.wikipedia.org/wiki/Single-responsibility_principle) at a package level... to reduce the number of reasons a domain needs to be refactored, we might also split domains into two: business logic, and  domain-specific, Atomic Organisms, Templates, etc. That way, we could choose to replace React with Svelte without touching the business logic or we could upgrade a dependency, even React, one package at a time.

We might end up with the following domains:

```shell
.
└── src
    ├── domains
    │   ├── companies     # Domain Logic
    │   ├── people        # Domain Logic
    │   └── products      # Domain Logic
    ├── lib
    │   ├── _components   # Domain agnostic react components
    │   └── fetch         # Domain Logic
    ├── layouts
    └── pages
```

Sometimes breaking concepts into domains is intuitive, but sometimes what is intuitive doesn't work well in the end. Consider the following as you choose your boundaries:

- How will the domains be coupled together?
  - Avoid circular dependencies
  - A lot of dependencies might indicate that two domains should be collapsed into one
  - Promote separation of concerns
  - For example, we could put atoms, molecules, and organisms in a single domain called, `_components`, but then it's easy to reference an organism from a molecule, and we shouldn't do that: molecules are combinations of atoms and organisms are combinations of atoms and molecules. So combining them in a single domain carries some risk with it.

When in doubt, go with your intuition and write your code so it is easy to refactor later.

### The Anatomy of a Domain

Like the Atomic packages, each domain will have an _index.ts_, _index.d.ts_ and a _package.json_ file. For a front-end app, the domain will likely integrate with API(s) and need to manage state. Here's what the companies domain might look like (borrowing some GraphQL terminology):

```shell
.
├── lib
    └── companies
        ├── index.d.ts
        ├── index.ts
        ├── package.json
        └── src
            ├── _components
            │   ├── Company.tsx             # Company Page Template
            │   ├── CompanyCard.tsx         # One Compnay for Companies Page
            │   └── Companies.tsx           # Company List Page Template
            │
            ├── io                          # I/O bound tasks (API integration)
            │   ├── fetch-upsert-company.ts # create / update <Company>
            │   ├── fetch-company-by-id.ts  # get <Company>
            │   └── fetch-find-companies.ts # get <Company[]>
            │
            ├── state                       # Repositories (local state/memory)
            │   ├── companies-store.ts      # store<Company[]>
            │   └── company-store.ts        # store<Company>
            │
            ├── typedefs                    # Models
            │   └── company.ts              # contract validation
            │
            └── usecases                    # Compute bound tasks
                │   # actions / behaviors
                ├── find-companies.ts
                ├── get-company-by-id.ts
                ├── upsert-company.ts
                │   # hooks
                ├── use-company.ts
                └── use-companies.ts
```

#### 1. Components (`_components/`)

- **Purpose**: Rendering the UX
- **Naming**: `{PascalCase}.tsx`
- **Responsibility**: Render the content and user experience on the screen.
- **Dependencies**: state, use cases

### 2. State (`state/`)

- **Purpose**: Keeps data in local memory or storage that components use to display data and react to changes the user makes. For stateful data that is long-lived (including localstorage) or shared across multiple components.
- **Naming**: `{noun}-store.ts` (e.g. `companies-store.ts`)
- **Responsibility**:
  - Data storage using zustand
  - Data mutation observability
- **Dependencies**: None (foundational layer)

### 3. Use Cases (`use-cases/`)

- **Purpose**: Compute bound tasks (actions/behaviors/computations/react-hooks)
- **Naming**: `{verb}-{noun}-{context?}.ts` (e.g. `get-company-by-id.ts`) or `use-{verb?}-{noun}.ts` (e.g. `use-companies.ts`, `use-find-companies.ts`)
- **Responsibility**:
  - Business logic
  - Computations
  - "Behaviors" in the context of BDD
  - React component business logic (e.g. routing, `useState`, `useParams`)
  - Separate React logic from business logic so business logic can be tested without having to set up elaborate fixtures
- **Dependencies**: I/O, typedefs

> It may be tempting to make behaviors granular: to take a functional approach to these and make them easier to test (i.e. breaking `create-company` into: `validate-request-body`, `make-id`, `save-to-db`, `cast-to-company`). However, this often results in exposing implementation details at the file level, which can defeat the core concept of a screaming architecture: to quickly understand domains, and their capabilities without reading any code, and to find functionality without needing intellisense, or cmd+f (find).

### 4. I/O (`io/`)

- **Purpose**: Requests to APIs using a library like fetch or axios, to read and write data
- **Naming**: `fetch-{verb}-{noun}-{context?}.ts` (e.g., `fetch-get-company-by-id.ts`)
- **Responsibility**:
  - API Request operations (e.g. fetch, axios, etc.)
- **Dependencies**: Logger, typedefs,

### 5. Typedefs (`typedefs/`)

- **Purpose**: Type definitions and validation schemas
- **Files**:
  - `{domain}.ts` - Core domain models
  - `{domain}-api-contracts.ts` - API request/response schemas
- **Responsibility**:
  - Zod schema definitions
  - TypeScript type exports
  - Data validation rules
  - Domain model constraints
  - Data transformation
- **Dependencies**: None (foundational layer)

### Pages

We can then compose the Organisms, Templates, and Domains into Pages that users interact with. Page files should be free of business logic, state management, etc. They are simply compositions of components.

```shell
.
└── src
    ├── layouts
    │   └── layout.tsx
    └── pages
        ├── companies
        │   ├── [company-id]
        │   │   ├── products
        │   │   │   ├── [product-id]
        │   │   │   │   └── index.tsx
        │   │   │   └── index.tsx
        │   │   └── index.tsx
        │   └── index.tsx
        ├── index.tsx
        └── ...
```

### Complete Example

```shell
.
└── src
    ├── index.css
    ├── main.tsx
    ├── layouts
    │   └── default-layout.tsx
    │
    ├── lib
    │   ├── _components
    │   │   ├── index.ts
    │   │   └── src
    │   │       ├── Buttons
    │   │       │   └── button
    │   │       ├── Cards
    │   │       │   └── ProductCard.tsx
    │   │       ├── Charts
    │   │       │   └── PieChart.tsx
    │   │       ├── Forms
    │   │       │   ├── FormField.tsx
    │   │       │   ├── search-form-store.ts
    │   │       │   └── SearchForm.tsx
    │   │       └── Inputs
    │   │           ├── input-store.ts
    │   │           └── Input.tsx
    │   │
    ├── companies
    │   ├── index.d.ts
    │   ├── index.ts
    │   ├── package.json
    │   ├── src
    │   │   ├── _components
    │   │   │   ├── Company.tsx
    │   │   │   ├── CompanyCard.tsx
    │   │   │   └── Companies.tsx
    │   │   │
    │   │   ├── io
    │   │   │   ├── fetch-upsert-company.ts
    │   │   │   ├── fetch-company-by-id.ts
    │   │   │   └── fetch-find-companies.ts
    │   │   │
    │   │   ├── state
    │   │   │   ├── companies-store.ts
    │   │   │   └── company-store.ts
    │   │   │
    │   │   ├── typedefs
    │   │   │   └── company.ts
    │   │   │
    │   │   └── usecases
    │   │       │   # actions / behaviors
    │   │       ├── find-companies.ts
    │   │       ├── get-company-by-id.ts
    │   │       ├── upsert-company.ts
    │   │       │   # hooks
    │   │       ├── use-company.ts
    │   │       └── use-companies.ts
    │   │
    │   ├── people
    │   │   ├── index.d.ts
    │   │   ├── index.ts
    │   │   ├── package.json
    │   │   └── src
    │   │       ├── _components
    │   │       │   ├── PersonCard.tsx
    │   │       │   └── People.tsx
    │   │       │
    │   │       ├── io
    │   │       │   ├── fetch-upsert-person.ts
    │   │       │   └── fetch-find-people.ts
    │   │       │
    │   │       ├── state
    │   │       │   ├── people-store.ts
    │   │       │   └── person-store.ts
    │   │       │
    │   │       ├── typedefs
    │   │       │   └── person.ts
    │   │       │
    │   │       └── usecases
    │   │           ├── find-people.ts
    │   │           ├── get-person.ts
    │   │           ├── update-person.ts
    │   │           ├── use-people.ts
    │   │           └── use-person.ts
    │   │
    │   └── products
    │       ├── index.ts
    │       └── src
    │           ├── _components
    │           │   ├── ProductCard.tsx
    │           │   ├── SearchProducts.tsx
    │           │   └── Products.tsx
    │           │
    │           ├── io
    │           │   ├── fetch-upsert-product.ts
    │           │   └── fetch-find-products.ts
    │           │
    │           ├── state
    │           │   ├── products-store.ts
    │           │   ├── product-store.ts
    │           │   ├── wishlist-store.ts
    │           │   └── wishlists-store.ts
    │           │
    │           ├── typedefs
    │           │   └── product.ts
    │           │
    │           └── usecases
    │               ├── add-product.ts
    │               ├── find-products.ts
    │               ├── get-product.ts
    │               ├── update-product.ts
    │               ├── use-product.ts
    │               └── use-products.ts
    │  
    │  
    ├── public
    │   ├── favicon.svg
    │   └── img
    │       └── placeholder-200-112-000-aaa.webp
    │
    └── pages
        ├── companies
        │   ├── [company-id]
        │   │   ├── products
        │   │   │   ├── [product-id]
        │   │   │   │   └── index.tsx
        │   │   │   └── index.tsx
        │   │   └── index.tsx
        │   └── index.tsx
        ├── index.tsx
        └── ...
```

_Note that Atomic Design is spread out in this example. Atoms, Molecules, and Organisms are coupled together in the `_components` domain. Templates are in their own domains, named for the domain they are coupled to (e.g. companies, people). Pages are in the root level src directory. Domain-specific Organisms are placed in the domain with affiliated Templates._

## Micro Frontends & Microservices

The examples provided here offer an approach to app development aimed to support refactoring and re-using the assets that are produced during app development. These examples provide an approach to:

- adopting structural benefits realized in microservice architectures without adopting the infrastructure / tooling complexity ([Micro Frontends](https://martinfowler.com/articles/micro-frontends.html) / Micro Backends)
- evaluating microservice boundaries: go to production with a monolith that composes these domains, observe the performance and load, observe the impacts of enhancements, and then optimize to microservices or serverless

Because the packages are all part of a monolithic package.json, this structure does not inherently mitigate risks associated with _accumulated dependency debt_ (the amount of effort required to accept changes to 3rd party dependencies over time multiplied by the pervasiveness of that dependency in an environment, scaled by duration of time passed since the last time an app's dependencies were upgraded or patched)

## Goals of a Screaming Architecture

- **Promote discovery**: it's easier to discover all of the files that belong to a given feature when they are located in the same folder
- **Reduce reverse-engineering**: when we create files for each behavior, we reduce the need to reverse engineer the contents of files as part of discovery. We are less likely to need an IDE's ability to “Go to declaration”, and “Find usages”.
- **Decouple by domain boundary**: If we are disciplined in encapsulating cross-domain dependencies, then a screaming architecture can
  - Reduce the effort required to refactor domains into their own services, or libraries (monolith to micro-service refactoring; mono-repo to multi-repo)
  - Simplify upgrades, especially when upgrading dependencies that have breaking changes... we can upgrade one domain at a time to get our tests to pass
  - Reduce time-to-fix, especially when a fix requires a breaking change in other domains

## Values of a Screaming Architecture

- **Developer comprehension**: organize, and name files so they promote discovery, and reduce reverse engineering
- **Developer workflow**: reduce context-switching, and reduce the distance between the files developers often touch when adding new, and modifying existing features. (_Try navigating the structure via the command line, instead of using an IDE, and then look for opportunities to reduce the necessity for changing directories (`cd`)_)
- **Shallow graphs**: to promote discovery, avoid nesting both files and control flow. Favor [functional composition](https://mostly-adequate.gitbook.io/mostly-adequate-guide/) over functions calling functions calling functions.
- **Refactorability**: assume we may need to pluck a domain out of the product and move it elsewhere. What can we do to make that trivial?

## Consequences

N/A

---

[^1]: Most modern API and web app development leverages existing frameworks to deliver functionality (e.g. express, or koa for Node.ts, MVC for .NET, Spring Boot for Java, Sinatra for Ruby, etc.). The documentation for many of these frameworks teaches developers to organize applications into scopes of responsibility that are based on the attributes of the framework (e.g. Models, Views, Controllers, Components, etc.).

  However, application developers spend most of their time working on scopes of responsibility that are based the features of the company they work at (e.g. companies, people, products). Architects spend much of their time working on scopes of responsibility that are based on infrastructure (e.g. apis, events, notifications, storage, etc.). Given the amount of time we spend in these domains, does it makes sense to organize our code around the attributes of the frameworks we choose to use?

  One thing I've seen time and time again, is that when we do organize code around the attributes of frameworks, it becomes difficult to understand which files are bound to a given context (e.g. companies, people, products), and as a result, we spend a lot of time trying to understand how something works instead of enhancing or changing it.
