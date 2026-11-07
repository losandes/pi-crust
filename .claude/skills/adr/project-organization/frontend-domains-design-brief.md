---
Context: Frontend apps
---

# Frontend Domain Design Brief

## Overview

This document describes the frontend domain architecture using Atomic Design principles with Domain-Driven Design (DDD). The structure follows a screaming architecture that emphasizes domain separation with clear component hierarchies and unidirectional data flow.

## App Directory Structure

```text
src/
  ├── domains/         # Business contexts & UI logic
  ├── layouts/         # Page layouts (shell with headers/nav)
  ├── lib/             # Reusable packages
  │   └── _components/ # Domain-agnostic components
  └── pages/           # Page composition and routes
```

## Domain Package Structure

Based on the companies domain implementation:

```text
domain-name/
  ├── index.ts              # Public API exports
  └── src/
      ├── _components/      # Domain-specific React components
      ├── io/               # API integration (I/O bound tasks)
      ├── state/            # Local state management (Zustand stores)
      ├── typedefs/         # Type definitions and schemas (Zod)
      └── use-cases/        # Business logic and React hooks (compute bound tasks)
```

## Layer Responsibilities

### 1. Components (`_components/`)

- **Purpose**: Domain-specific UI rendering (Templates and Organisms)
- **Naming**: `{PascalCase}.tsx` (e.g., `Company.tsx`, `CompanyCard.tsx`)
- **Responsibility**:
  - Render domain-specific content and user experience
  - Template-level components for page layouts
  - Organism-level components for complex UI sections
  - Molecule-level components for simple UI sections
  - Consume state and use-cases for data and interactions
- **Dependencies**: State, Use Cases, Shared Components

### 2. State (`state/`)

- **Purpose**: Local state management for domain data
- **Naming**: `{noun}-store.ts` (e.g., `companies-store.ts`, `company-store.ts`)
- **Responsibility**:
  - Data storage using Zustand
  - State mutations and observability
  - Long-lived or shared component state
  - Local storage integration
- **Dependencies**: None (foundational layer)

### 3. Use Cases (`use-cases/`)

- **Purpose**: Business logic and React component logic
- **Naming**:
  - Actions: `{verb}-{noun}-{context?}.ts` (e.g., `find-companies.ts`)
  - Hooks: `use-{verb?}-{noun}.ts` (e.g., `use-companies.ts`)
- **Responsibility**:
  - Business logic and computations
  - React hooks for component behavior
  - Routing logic and URL parameter handling
  - State management coordination
  - Separation of React concerns from business logic
- **Dependencies**: I/O, State, Typedefs

### 4. I/O (`io/`)

- **Purpose**: API integration and external data fetching
- **Naming**: `fetch-{verb}-{noun}-{context?}.ts` (e.g., `fetch-company-by-id.ts`)
- **Responsibility**:
  - HTTP requests using fetch/axios
  - API response handling
  - API Contract validation
  - Request/response transformation
  - Error handling for network operations
- **Dependencies**: Typedefs

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
  - Data transformation utilities
- **Dependencies**: None (foundational layer)

## Key Design Patterns

### Screaming Architecture

- **Organization by Domain**: Group files by business concepts, not technical layers
- **Discoverable Behaviors**: Name files for capabilities, not implementation details
- **Isolation**: Each domain should be independently maintainable

### Atomic Design Integration

- **Atoms, Molecules, Organisms**: Located in `lib/_components` (domain-agnostic)
- **Molecules, Organisms, Templates**: Located in domain `_components` (domain-specific)
- **Pages**: Located in `pages/` directory (composition layer).
  - Pages are pure compositions of components (no business logic).
  - Follow file-based routing convention with dynamic segments (`[parameter]`)
- **Unidirectional Dependencies**: Atoms ← Molecules ← Organisms ← Templates ← Pages

### Functional Architecture

- Pure functions for business logic in use-cases
- Immutable state updates in stores
- Clear input/output contracts
- Separation of React concerns from business logic

### State Management

- Domain-specific stores for encapsulation
- Reactive updates for component re-rendering

### Type Safety

- Comprehensive Zod schemas for runtime validation
- TypeScript types derived from schemas
- API contracts ensure type safety across boundaries

### Component Composition

- Domain-agnostic components in shared library
- Domain-specific components in domain packages
- Pages compose domains and layouts

## Data Flow

```text
User Interaction → Component → Use Case → I/O → API
       ↓              ↓          ↓       ↓
   Event Handler → State Update → Business Logic → Data Fetch
       ↓              ↓          ↓       ↓
   Re-render ← State Change ← Transform ← Response
```

## Component Hierarchy

```text
Pages (Route Composition)
  ↓
Templates (Page-level Layout)
  ↓
Organisms (Complex UI Sections)
  ↓
Molecules (Simple UI Groups)
  ↓
Atoms (Basic UI Elements)
```

## Testing Strategy

- Unit tests for use-cases and utilities
- Component testing with React Testing Library
- Integration tests for API interactions
- Test files co-located with implementation: `*.test.ts`

## Naming Conventions

- **Domains**: Plural nouns (companies, products, users)
- **Components**: `{PascalCase}.tsx`
- **Stores**: `{noun}-store.ts`
- **Use Cases**: `{verb}-{noun}.ts` or `use-{noun}.ts`
- **I/O**: `fetch-{verb}-{noun}.ts`
- **Types**: `T{PascalCase}` for TypeScript types
- **Schemas**: `{camelCase}Schema` for Zod schemas

## Benefits

1. **Separation of Concerns**: Each layer has a single responsibility
2. **Testability**: Pure functions and isolated business logic
3. **Type Safety**: End-to-end type checking from API to UI
4. **Maintainability**: Clear structure and atomic design principles
5. **Scalability**: Independent domain packages
6. **Reusability**: Shared component library and domain encapsulation
7. **Developer Experience**: Screaming architecture for quick feature discovery
