---
Context: Backend apps
---

# Backend Domain Design Brief

## Overview

This document describes the backend domain architecture as exemplified by the `books` domain in the reference API. The structure follows Domain-Driven Design (DDD) principles with clear separation of concerns and unidirectional data flow.

## App Directory Structure

```text
src/
  ├── db/              # Database schemas and seeding
  ├── domains/         # Business contexts & logic
  ├── lib/             # Reusable packages
  └── server/          # express server composition
```

## Domain Package Structure

Based on the books domain implementation:

```text
domain-name/
  ├── index.ts              # Public API exports
  └── src/
      ├── data/             # Database operations (mutations and resolvers)
      ├── typedefs/         # Type definitions and schemas
      └── use-cases/        # Business logic, contracts, and API handlers
```

## Layer Responsibilities

### 1. Data (`data/`)

- **Purpose**: Database operations (both read and write)
- **Naming**:
  - `mutate-{entity}-{action}.ts` for write operations (e.g., `mutate-book-create.ts`, `mutate-book-update.ts`, `mutate-book-delete.ts`)
  - `resolve-{entity}-{context}.ts` for read operations (e.g., `resolve-book-by-id.ts`, `resolve-books-find.ts`)
- **Responsibility**:
  - Direct database operations using Drizzle ORM
  - Audit trail creation for mutations
  - Transaction management
  - Data validation and transformation
  - Result formatting
- **Dependencies**: Database, Logger, Typedefs

### 2. Typedefs (`typedefs/`)

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

### 3. Use Cases (`use-cases/`)

- **Purpose**: Business logic, contracts, and API handlers
- **Naming**: `{verb}-{entity}.ts` (e.g., `create-book.ts`, `update-book.ts`, `delete-book.ts`, `get-book-by-id.ts`, `find-books.ts`)
- **Responsibility**:
  - API endpoint implementation using Elysia
  - API contract definitions (request/response schemas)
  - Request validation using TypeBox schemas
  - Response formatting and status codes
  - Error handling
  - Orchestrating data operations
  - Business logic and rules
  - Dependency injection and composition
- **Dependencies**: Data operations, Typedefs, Router context

## Key Design Patterns

### 1. Dependency Injection

- All functions are factory functions that accept dependencies
- Database connections, loggers, and other services are injected
- Enables testing and modularity
- Avoid imports that dig into other domain's src directories. Export all dependencies that need to be imported from the domain's root index.ts file.

### 2. Functional Architecture

- Pure functions where possible
- Immutable data structures
- Clear input/output contracts

### 3. Error Handling

- Structured error responses with status codes
- Validation errors using Zod
- Audit logging for all operations

### 4. Type Safety

- Comprehensive Zod schemas for runtime validation
- TypeScript types derived from schemas
- API contracts ensure type safety across boundaries

### 5. Audit Trail

- All mutations create audit records
- Immutable audit log for compliance
- Timestamped with user context

## Data Flow

```text
Request → Use Case Handler → Data Operations → Database
                ↓                ↓              ↓
            Validation → Business Logic → Audit Trail
                ↓                ↓              ↓
            Response ← Format ← Transform ← Result
```

## Testing Strategy

- Unit tests for each layer in isolation
- Dependency injection enables easy mocking
- Test files co-located with implementation: `*.test.ts`

## Naming Conventions

- **Domains**: Plural nouns (books, users, companies)
- **Use Cases**: `{verb}-{entity}` (create-book, find-books)
- **Mutators**: `mutate-{entity}-{action}` (mutate-book-create, mutate-book-update)
- **Resolvers**: `resolve-{entity}-{qualifier}` (resolve-book-by-id, resolve-books-find)
- **Types**: `T{PascalCase}` for TypeScript types
- **Schemas**: `{camelCase}Schema` for TypeBox schemas

## Benefits

1. **Separation of Concerns**: Each layer has a single responsibility
2. **Testability**: Dependency injection and pure functions
3. **Type Safety**: End-to-end type checking
4. **Maintainability**: Clear structure and naming conventions
5. **Scalability**: Independent domain packages
6. **Auditability**: Built-in audit trail for all operations
