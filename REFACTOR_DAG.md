# Refactor: Serial Lifecycle to DAG-Based Workflow Orchestration

A plan, not a record. Delete it when the work lands and the decisions move into records and READMEs.

## Objective

Refactor the existing serial, waterfall-style lifecycle implementation into a **Directed Acyclic Graph (DAG)** capable of coordinating concurrent activities, resolving dependencies, and evaluating progression through explicit gates.

This is an architectural refactoring of an existing system, not a replacement or greenfield implementation.

Preserve existing capabilities, behaviors, instructions, artifacts, integrations, and runtime conventions unless a change is necessary to support the new orchestration model. Reuse existing abstractions where their responsibilities remain appropriate, and adapt or replace them where the new model requires different semantics.

The refactoring should establish consistent domain terminology that distinguishes lifecycle progression, workflow orchestration, and runtime state.

## 1. Domain Vocabulary

Adopt the following terminology throughout the domain model, orchestration logic, configuration, and relevant documentation.

| Concept              | Definition                                                                       | Responsibility                                                               |
| -------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Lifecycle**        | The defined progression of an objective from inception through completion.       | Establishes phases, objectives, and progression semantics.                   |
| **Stage**            | A logical phase within a lifecycle containing one or more activities.            | Groups related work under a shared objective.                                |
| **Activity**         | A discrete, independently executable unit of work within a stage.                | Performs work and produces results or artifacts.                             |
| **Gate**             | The conditions that must be satisfied before lifecycle progression is permitted. | Evaluates evidence and controls progression.                                 |
| **Workflow**         | The executable arrangement of activities, dependencies, and gates.               | Coordinates execution, concurrency, and dependencies.                        |
| **Run**              | A runtime instance of a defined unit of work.                                    | Tracks runtime state, results, and failures.                                 |
| **Context Envelope** | Structured context passed between activities or stages.                          | Preserves knowledge, decisions, evidence, and artifacts for downstream work. |

### Terminology Boundaries

- A **Lifecycle** describes the intended progression of an objective.
- A **Workflow** describes how work is executed to achieve that progression.
- A **Stage** represents a logical objective, not necessarily an indivisible unit of execution.
- An **Activity** represents meaningful work, not necessarily a single atomic operation.
- A **Gate** evaluates whether progression is justified, independently of whether execution has completed.
- A **Run** is a runtime instance of a definition. Definitions describe what can execute; Runs record what happened during a particular invocation.
- A **Context Envelope** carries relevant knowledge between Activities or Stages, independently of the mechanism used to execute them.

Use *Task* only when referring to finer-grained operations internal to an Activity, where that distinction is necessary.

Avoid introducing additional domain concepts when the existing vocabulary adequately describes the responsibility.

### Run Identity and Scope

The existing implementation uses `Run` and `runId` to identify and track work. Preserve this terminology and its established semantics.

Conceptually, a Workflow Run coordinates the Activity Runs that contribute to its completion.

However, the precise scope of existing Runs must be established from the implementation before introducing new relationships or runtime abstractions.

Distinguish a Run from an Attempt when necessary:

- **Run:** A logical invocation of work, identified by a `runId`.
- **Attempt:** An individual effort to complete that work. A Run may have multiple Attempts when retries are supported.

Do not introduce Attempt as a formal domain concept unless the existing implementation or new requirements justify it.

Preserve existing Run identifiers, persistence structures, and external contracts wherever possible.

## 2. Existing Architecture and Intended Transformation

### Current Model

The existing implementation executes a serial sequence of steps.

Conceptually:

`Step A → Step B → Step C → Step D → Completion`

Each step must finish before the next begins, regardless of whether the work actually depends on its predecessor.

This imposes an execution order that may not reflect the true dependency relationships between operations.

### Target Model

Replace implicit sequential execution with a DAG of explicitly dependent Activities and Gates, organized into Stages within a Lifecycle.

For example:

```text
Lifecycle
│
├── Stage: Discover
│   ├── Activity: Technical Research ─┐
│   ├── Activity: UX Research ────────┤
│   └── Activity: Requirements ───────┤
│                                    ▼
│                              Gate: Discover
│                                    │
├── Stage: Design                    │
│   ├── Activity: UX Design ◄────────┤
│   ├── Activity: Technical Design ◄─┘
│   │
│   └── Gate: Design
│            │
├── Stage: Implement
│   ├── Activity: Build
│   ├── Activity: Test Authoring
│   ├── Activity: Verification
│   └── Gate: Implement
│
└── Completion
```

This example illustrates logical organization, not a prescribed lifecycle configuration. Actual dependencies must be derived from the requirements of each Activity.

The target system must support:

- Multiple Activities within a Stage.
- Concurrent execution of independent Activities.
- Explicit dependencies between Activities.
- Dependencies spanning Stage boundaries when appropriate.
- Synchronization before Gates evaluate required results.
- Evidence-based progression decisions.
- Re-running work when prior results require revision.

**Stages remain logical boundaries for objectives and evaluation, not artificial barriers that serialize otherwise independent work.**

A Stage's Gate controls lifecycle progression. It should not impose unnecessary scheduling dependencies on Activities that are legitimately independent of that Gate.

## 3. Refactoring Requirements

### 3.1 Preserve Existing Behavior

Begin by understanding the existing implementation.

Identify:

- Current execution steps and their responsibilities.
- Existing lifecycle or workflow configuration.
- Agent and tool invocation mechanisms.
- Context propagation between steps.
- Artifact creation and persistence.
- Run identity, state, and persistence.
- Failure, retry, and cancellation behavior.
- Completion and progression criteria.
- Existing interfaces and consumers of Run state.

Map existing steps into the new domain vocabulary.

Do not assume every existing step should become an Activity. Some existing steps may represent Stages, Gates, orchestration concerns, or implementation details.

Preserve behavior unless it conflicts with the target architecture or an explicitly stated requirement.

#### Preserve Existing Run Semantics

The current implementation uses `Run` and `runId` to identify and track work.

Retain this vocabulary and existing identifiers, persistence structures, and external contracts.

Determine whether the existing Run abstraction represents an entire workflow, an individual step, or both before adapting it to the DAG model.

Introduce additional Run types or relationships only where the new orchestration requirements justify them.

Do not silently redefine what an existing `runId` represents.

### 3.2 Separate Lifecycle Definition from Workflow Orchestration

The existing serial process may conflate lifecycle progression with execution.

Separate these responsibilities.

**Lifecycle responsibilities:**

- Define Stages and their objectives.
- Associate Activities with Stages.
- Establish progression criteria through Gates.
- Track lifecycle progression and completion.

**Workflow responsibilities:**

- Represent executable dependencies as a DAG.
- Determine which Activities are eligible to execute.
- Schedule independent Activities concurrently.
- Observe Run outcomes.
- Coordinate synchronization and dependency resolution.
- Make eligible Gates available for evaluation.

The Workflow must not independently decide that lifecycle objectives have been satisfied merely because all executable nodes have completed.

### 3.3 Replace Sequential Ordering with Explicit Dependencies

The current implementation may derive execution order from the position of a step within a list.

Replace this assumption with explicit dependencies.

An Activity becomes eligible for execution when its required dependencies have been satisfied.

The scheduler must:

- Execute independent Activities concurrently.
- Delay dependent Activities until their prerequisites are satisfied.
- Distinguish successful dependencies from failed, blocked, or skipped dependencies.
- Prevent execution when dependency requirements cannot be satisfied.
- Detect invalid or cyclic dependencies before execution.

Define ordering only where a genuine dependency exists.

A serial workflow must remain representable as a valid DAG. This allows existing configurations to retain their execution semantics during migration.

### 3.4 Introduce Explicit Gates

A Gate determines whether the results of a Stage satisfy its progression requirements.

Activity Run status and Gate evaluation must remain independent.

The conceptual progression is:

`Required Activities Settle → Gate Evaluates → Progression Decision`

A Gate may produce:

| Outcome     | Meaning                                                                         |
| ----------- | ------------------------------------------------------------------------------- |
| **Pass**    | Acceptance criteria are satisfied; progression is permitted.                    |
| **Fail**    | Acceptance criteria are not satisfied; revision or additional work is required. |
| **Blocked** | Required evidence or conditions are unavailable, preventing evaluation.         |

A Gate must evaluate the outputs and evidence produced by relevant Activities, not merely whether their Runs completed successfully.

Preserve existing verification or approval behavior by adapting it into this model rather than duplicating it.

A Gate must not evaluate prematurely when required upstream work remains unresolved.

A Gate passing permits lifecycle progression; it does not necessarily indicate that every Activity associated with the Stage has executed, particularly where optional or conditional work is supported.

### 3.5 Support Parallel Activity Execution

Activities without unsatisfied dependencies should be eligible to execute concurrently.

Concurrency must not compromise:

- Context integrity.
- Artifact consistency.
- Filesystem or repository safety.
- Run-state consistency.
- Deterministic dependency resolution.
- Failure isolation.

Evaluate existing shared-state assumptions that were safe under serial execution but may become unsafe under concurrency.

Where multiple Activities produce results consumed by a common downstream Activity or Gate, define how their outputs are collected and combined.

Concurrency should be bounded by appropriate resource constraints rather than assuming unlimited parallelism.

### 3.6 Preserve Context Envelopes

The existing implementation passes context between serial steps.

Adapt this mechanism for DAG-based execution without losing its original purpose.

A Context Envelope carries the knowledge necessary for downstream work, including:

- Objective and scope.
- Findings and supporting evidence.
- Decisions and rationale.
- Artifacts and references.
- Assumptions and unresolved questions.
- Verification results.
- Applicable requirements and constraints.

In a DAG, an Activity may have multiple upstream dependencies.

The system must support constructing its input context from the relevant upstream envelopes.

Context propagation must:

- Preserve provenance.
- Avoid accidental overwriting or loss of information.
- Handle independent upstream results.
- Identify conflicting findings rather than silently resolving them.
- Avoid unnecessarily reproducing complete Run histories.

Treat upstream envelopes as immutable results of their respective Runs. Derived downstream context should not mutate the source envelopes.

When an Activity is re-run, downstream consumers must be able to identify which results are current and which have been superseded.

### 3.7 Run State and Failure Handling

Track Run state independently from lifecycle progression.

An Activity definition may have multiple Runs over time.

The runtime must distinguish, where applicable:

- Pending.
- Ready.
- Running.
- Succeeded.
- Failed.
- Skipped.
- Blocked.
- Cancelled.

These are illustrative states; reconcile them with the existing implementation before introducing new ones.

A failed Activity Run must not automatically imply failure of the entire Lifecycle.

Failure handling should account for:

- Retriable failures.
- Non-retriable failures.
- Optional Activities.
- Unavailable dependencies.
- Gate rejection.
- Cancellation.
- Partial completion.

Preserve existing retry and recovery semantics where possible.

#### Retries vs. Revisions

Retrying failed work and revising previously completed work are distinct operations.

A retry may represent another Attempt within the same Run, preserving its `runId`, depending on existing semantics.

A revision involving changed inputs, new requirements, or invalidated downstream results may require a new Run.

Preserve the existing implementation's identity and retry conventions unless they conflict with these requirements.

### 3.8 Re-running Work Without Cyclic Dependencies

A Workflow DAG must remain acyclic.

However, a Lifecycle must support iterative development.

For example, a failed verification Gate may require changes to implementation before verification can be repeated.

Represent iterative work through new Runs, preserving the results and provenance of prior Runs, rather than introducing backward edges into the same Workflow DAG.

A revision should:

- Identify the work requiring revision.
- Preserve prior Run results and their provenance.
- Re-run the necessary Activities.
- Invalidate dependent results where appropriate.
- Re-evaluate affected Gates.
- Avoid repeating unrelated work unnecessarily.

Do not assume Gate failure requires restarting an entire Stage or Lifecycle.

The orchestration model should support targeted revision while maintaining a coherent history of what was executed and why.

## 4. Configuration and Composition

The architecture should support defining Lifecycles declaratively, using existing configuration mechanisms where possible.

A Lifecycle definition must be capable of expressing:

- Its constituent Stages.
- The Activities associated with each Stage.
- Dependencies between Activities and Gates.
- Stage progression criteria.
- The execution capability or agent associated with each Activity.
- Context requirements and produced outputs.

The same Activity capability may participate in different Lifecycles or Stages without requiring duplicate implementations.

For example, Technical Research may be invoked during discovery, design, or verification.

Separate the definition of what an Activity does from where it participates in a Lifecycle.

Avoid embedding specific SDLC stages, agents, or activities directly into the orchestration engine.

The DAG representation should be derived from explicit configuration rather than hardcoded assumptions about lifecycle ordering.

## 5. Refactoring Approach

Implement the transformation incrementally.

### Step 1 — Analyze the Existing System

Inspect the implementation and document how the existing serial model operates.

Identify domain concepts, orchestration responsibilities, context-handling mechanisms, Run management, persistence, and external contracts.

Produce a mapping from existing concepts to the target vocabulary.

Identify behavior that must be preserved and assumptions that will break under concurrency.

### Step 2 — Establish the Domain Model

Refactor existing abstractions to establish clear boundaries between Lifecycle, Stage, Activity, Gate, Workflow, Run, and Context Envelope.

Prefer adapting existing structures rather than creating parallel implementations of equivalent concepts.

Preserve `Run`, `runId`, and their existing semantics.

Preserve external compatibility where practical, and make unavoidable breaking changes explicit.

### Step 3 — Introduce DAG-Based Orchestration

Replace implicit serial iteration with dependency-based scheduling.

Implement dependency validation, scheduling eligibility, concurrency, synchronization, and terminal-outcome handling.

Ensure a fully serial DAG reproduces the existing ordering and behavior before introducing parallel execution.

### Step 4 — Adapt Context Propagation

Extend the existing context mechanism to support multiple upstream Activity results.

Preserve the semantics of existing Context Envelopes while introducing explicit provenance and safe composition.

Ensure the context associated with each Run remains identifiable.

### Step 5 — Integrate Gates and Lifecycle Progression

Separate completion of executable work from acceptance of lifecycle objectives.

Adapt existing verification and progression logic into explicit Gate evaluations.

Ensure progression decisions are supported by the required evidence.

### Step 6 — Enable Concurrent Activities

Introduce parallel execution for independent Activities.

Address shared-state access, artifact conflicts, cancellation, resource limits, and error propagation.

Do not introduce concurrency before the relevant Run and context boundaries are safe.

### Step 7 — Verify Compatibility and New Behavior

Verify both preservation of existing capabilities and correctness of DAG orchestration.

## 6. Acceptance Criteria

The refactoring is complete when the following conditions are satisfied.

### Domain Model

- [ ] The agreed vocabulary is used consistently.
- [ ] Lifecycle progression is distinct from Workflow orchestration.
- [ ] Activity definitions are distinct from runtime Runs.
- [ ] Gates explicitly govern progression.
- [ ] Existing concepts have been migrated or reconciled without redundant parallel abstractions.
- [ ] Existing `Run` and `runId` semantics are preserved or explicitly migrated where necessary.

### Orchestration

- [ ] Existing serial workflows can run with equivalent behavior.
- [ ] Dependencies are represented explicitly.
- [ ] Cyclic dependencies are rejected before execution.
- [ ] Independent Activities can execute concurrently.
- [ ] Dependent Activities wait for their required prerequisites.
- [ ] Gates wait for required upstream results.
- [ ] Failures, skipped work, blocked dependencies, and cancellation are handled consistently.
- [ ] Re-running work does not introduce cycles into Workflow DAGs.
- [ ] Retries and revisions preserve appropriate Run identity and history.

### Context and Artifacts

- [ ] Context Envelopes can be composed from multiple upstream results.
- [ ] Context provenance is preserved.
- [ ] Conflicting results are not silently overwritten.
- [ ] Parallel execution does not introduce unsafe shared-state mutations.
- [ ] Re-runs do not silently replace historical context or artifacts.
- [ ] Existing artifact creation and persistence behavior remain functional.

### Verification

- [ ] Tests cover serial execution compatibility.
- [ ] Tests demonstrate independent Activities running concurrently.
- [ ] Tests verify dependency ordering and synchronization.
- [ ] Tests cover cycle detection.
- [ ] Tests cover partial failures and blocked dependencies.
- [ ] Tests cover Gate acceptance and rejection.
- [ ] Tests cover context composition from parallel Activities.
- [ ] Tests cover retries and re-running revised work.
- [ ] Tests verify Run identity and persistence behavior.
- [ ] Existing relevant tests continue to pass, or any necessary changes are explained.

## 7. Architectural Principles

Apply these principles throughout the refactoring:

1. **Preserve before replacing.** Retain existing behavior and abstractions unless their responsibilities conflict with the target architecture.
2. **Model dependencies explicitly.** Execution order must derive from dependency relationships rather than list position.
3. **Separate progression from execution.** Work completing is not equivalent to objectives being satisfied.
4. **Concurrency is a consequence of independence.** Activities execute in parallel when dependencies and resource constraints permit.
5. **Treat context as evidence.** Preserve provenance, decisions, and relevant findings across Run boundaries.
6. **Keep definitions separate from Runs.** Runtime state and history must not be conflated with reusable Activity or Workflow definitions.
7. **Preserve Run identity.** Respect existing `runId` semantics and distinguish retries from revisions where necessary.
8. **Preserve acyclicity.** Model iterative work using Runs rather than cyclic workflow definitions.
9. **Avoid unnecessary abstractions.** Extend existing capabilities and introduce new concepts only where they clarify responsibilities or enable required behavior.
10. **Verify behavioral equivalence.** Architectural improvements must not silently regress the existing system.

## Expected Outcome

The existing serial lifecycle implementation is transformed into a DAG-based orchestration architecture.

The system continues to model an objective progressing through a Lifecycle, with Stages defining meaningful phases, Activities performing work, Gates evaluating acceptance criteria, and Context Envelopes preserving knowledge between Runs.

The Workflow engine coordinates the resulting DAG, executing independent work concurrently while respecting dependencies, resource constraints, and lifecycle progression rules.

Runs provide the runtime identity and history of work performed, preserving the existing system's conventions while supporting parallelism, retries, and revisions.

**The desired result is an evolution of the existing system: from serial execution of predefined steps to dependency-driven orchestration of activities within a governed lifecycle.**
