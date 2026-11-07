# From not knowing... to knowing... to doing... to knowing what happened

Software development is a process of progressively reducing uncertainty before committing to increasingly expensive or difficult-to-reverse decisions.

Do not begin by writing code.

Begin by establishing what is known, what is unknown, what is assumed, what evidence is available, and what must be learned before implementation can proceed safely.

Each stage exists to achieve a specific objective and reduce a specific class of uncertainty. At the end of each stage, produce a **context envelope** containing the evidence, decisions, constraints, assumptions, unresolved questions, and artifacts necessary for the next stage to evaluate the work.

The next stage acts as a **gate**. It must evaluate whether the previous stage achieved its objective before accepting its context and proceeding.

At every stage:

- distinguish **facts, decisions, assumptions, hypotheses, and unresolved questions**;
- prefer evidence from the repository, running system, tests, documentation, and authoritative sources over inference;
- do not silently resolve material ambiguity;
- reduce uncertainty before increasing implementation commitment;
- preserve decisions and constraints established by earlier stages unless new evidence invalidates them;
- regress to an earlier stage when new evidence invalidates an assumption, requirement, design, or plan;
- produce only as much artifact and implementation as necessary to reach the next justified decision;
- treat working software as evidence, not proof of correctness.

The workflow is not strictly linear. Progress when the uncertainty relevant to the next stage has been sufficiently reduced. Move backward whenever new evidence invalidates the basis on which later work depends.

## Stage Transition Rules

### Gate Rule

Do not accept the output of a previous stage merely because its expected artifacts exist.

Evaluate whether the stage achieved its objective and reduced the uncertainty it was responsible for reducing.

Reject or return incomplete context when proceeding would require inventing material facts, requirements, decisions, or assumptions that the previous stage should have established.

### Context Rule

Pass forward the information necessary to preserve intent and prevent downstream reinterpretation.

Context envelopes should distinguish:

- established facts;
- supporting evidence;
- decisions and their rationale;
- requirements and constraints;
- assumptions;
- unresolved questions;
- risks and known failure modes;
- relevant artifacts;
- evidence that the stage's objective was achieved.

Do not require downstream stages to reconstruct decisions that are already known.

### Progression Rule

Advance only when the information required by the next stage is known or its remaining uncertainty has been explicitly identified and accepted.

### Regression Rule

When new evidence invalidates an earlier assumption or decision, return to the earliest affected stage.

Do not compensate for an invalid upstream decision with downstream complexity.

### Evidence Rule

Prefer observation and deterministic verification over inference.

Never treat plausibility as evidence when the relevant fact can reasonably be inspected, measured, executed, or tested.

### Authority Rule

Do not make a consequential product, domain, or architectural decision merely because implementation requires one.

If a necessary decision has not been established and cannot be derived from existing evidence and constraints, surface it as unresolved and return it to the stage responsible for making that decision.

### Traceability Rule

Material implementation decisions must be traceable to a requirement, constraint, architectural decision, observed system behavior, or newly discovered evidence.

### Minimal Commitment Rule

Make the least irreversible commitment necessary to obtain the next useful evidence.

### Completion Rule

A stage is complete because its objective has been achieved and its relevant uncertainty has been sufficiently reduced, not because its example deliverables have been produced.

---

# 1. Discover to De-risk | Design Thinking

**Goal: Build the right things.**

Discovery establishes the problem and progressively constrains the set of acceptable solutions.

Do not optimize for producing an implementation during this phase. Optimize for eliminating incorrect interpretations, invalid assumptions, unnecessary scope, and unsuitable solution approaches before they become code.

## 1.1 Evaluate

**Objective:** Understand the initiating problem, question, request, or observed condition before deciding what should change.

### Activities

- Inspect available evidence.
- Establish the current state before proposing a future state.
- Separate observed facts from interpretations.
- Identify contradictions, ambiguity, missing information, and assumptions.
- Determine why the problem matters and what outcome would constitute meaningful improvement.
- Identify constraints that already limit the solution space.
- Do not infer requirements merely because they would make a particular implementation convenient.

### Example Deliverables

- Concept
- Question
- Challenge
- Initial Evidence
- Known Constraints
- Open Questions

### Learning Objectives

- What is happening?
- Why does it matter?
- What do we know?
- What do we only believe?
- What remains uncertain?

### Gate

Proceed when the problem is sufficiently understood to investigate a specific opportunity rather than an inferred or prematurely selected solution.

---

## 1.2 Identify

**Objective:** Convert the observed problem into an explicit opportunity and define what must be true of a successful solution.

### Activities

- Define the desired outcome without prematurely specifying implementation.
- Establish scope and boundaries.
- Identify affected actors, systems, domains, workflows, and dependencies.
- Define success and failure conditions.
- Identify requirements and constraints supported by evidence.
- Surface unresolved questions that could materially alter the opportunity.
- Disqualify interpretations that conflict with known evidence.

### Example Deliverables

- Opportunity Statements
- Research Brief
- Requirements
- Constraints
- Success Criteria
- Scope / Non-Scope

### Learning Objectives

- What opportunity are we actually pursuing?
- For whom?
- What must change?
- What must remain true?
- How will we recognize success?

### Gate

Proceed when the desired outcome and boundaries are sufficiently constrained to evaluate possible solutions.

---

## 1.3 Conceptualize

**Objective:** Determine what the solution needs to mean and do before deciding exactly how it will be implemented.

Separate **conceptual and logical architecture** from physical implementation choices.

### Activities

- Model the relevant domain and behavior.
- Identify responsibilities and boundaries.
- Establish required capabilities and invariants.
- Develop candidate approaches where meaningful alternatives exist.
- Compare approaches against requirements and constraints rather than selecting based on familiarity.
- Prefer the simplest architecture that satisfies known requirements while preserving necessary future options.
- Identify assumptions whose failure would invalidate the architecture.
- Identify what must eventually be observable to determine whether the system is behaving correctly and producing the intended outcome.
- Explicitly identify uncertainty that should be tested through a POC rather than resolved through additional speculation.

### Example Deliverables

- Conceptual Architecture
- Logical Architecture
- Prioritized Objectives
- Answer
- Solution
- Domain Model
- Candidate Solutions
- Evolving Vision
- Personas
- Stories
- Architectural Questions

**References**:

- [Types of Engineering Architecture](types-of-architecture.md)
- [PRD Template](./prd-template.md)

### Learning Objectives

- What capabilities are required?
- What should own each responsibility?
- What relationships and invariants must hold?
- Which solution approaches satisfy the requirements?
- Which architectural assumptions remain uncertain?
- What must ultimately be knowable about the system in operation?

### Gate

Proceed when there is a coherent logical solution whose remaining material uncertainty can be tested or addressed during implementation planning.

---

# 2. Focus to Implement | Agile Delivery

**Goal: Prioritize the right things and build them right.**

This phase converts an accepted logical solution into tested physical implementation.

It is intentionally iterative.

New evidence discovered during planning, design, implementation, or testing may invalidate earlier conclusions. When that happens, do not work around the contradiction merely to preserve forward progress. Return to the earliest affected decision, revise it, and propagate the change forward.

Operational understanding is part of correctness. Software must be designed so that its important behavior can be understood after it leaves the development environment.

Observability is therefore a design concern, not instrumentation added after implementation.

Logs, metrics, traces, events, and retained diagnostic data have costs. Do not instrument everything by default. Design for the **minimum sufficient observability** required to:

- determine whether the system is behaving as intended;
- measure the success criteria established during Discovery;
- detect important failures and regressions;
- diagnose likely failure modes;
- distinguish between materially different system states when that distinction affects action;
- support operation of the system without creating unnecessary cost, noise, cardinality, storage, or privacy risk.

---

## 2.0 Proof of Concept | POC

**Objective:** Learn, disprove, and de-risk conceptual and logical architectures before committing uncertain architectural decisions to production implementation.

A POC is an experiment, not an early production implementation.

Every POC must begin with a question or hypothesis. Do not create a POC merely to demonstrate that code can be written.

Use POCs when evidence cannot cheaply resolve a material uncertainty.

### Activities

- State the hypothesis or question before experimentation.
- Define what evidence would support or disprove it.
- Test the smallest implementation capable of answering the question.
- Prefer testing the highest-risk assumptions first.
- Exercise real boundaries and failure modes when those are the source of uncertainty.
- Use measurement where observation is necessary to answer the hypothesis.
- Record unexpected findings when they materially affect the architecture.
- Discard implementation artifacts that should not become production code.

### Learning Objectives

- How feasible is the idea?
- Which assumptions survive contact with implementation?
- How might we design the physical architecture?
- What complexities do we face?
- Which complexity is essential and which is accidental?
- What implementation sequence will expose failure and uncertainty earliest?
- What must be observable to understand behavior that cannot be established statically?

### Gate

Proceed when the material uncertainty being tested has been reduced enough to make a design decision.

If the proposed architecture has been disproved, return to the appropriate earlier stage.

---

## 2.1 Plan

**Objective:** Convert the accepted solution into an executable sequence of independently understandable, verifiable changes.

Planning should reduce execution-time reasoning rather than merely enumerate tasks.

### Activities

- Decompose work into coherent increments.
- Establish dependencies and implementation order.
- Front-load work that exposes uncertainty or failure earliest.
- Define acceptance criteria for each increment.
- Identify required tests and verification before implementation.
- Identify what evidence will be required after deployment to determine whether the change is behaving correctly.
- Identify important failure modes that must be detectable in operation.
- Include observability work in the implementation plan rather than treating it as optional follow-up work.
- Identify migration, compatibility, rollout, and rollback concerns where relevant.
- Keep scope traceable to requirements and architectural decisions.
- Do not add speculative work merely because it may be useful later.

### Example Deliverables

- Product Requirements Document(s)
- Implementation Plan
- Sprint Plan(s)
- Impact Prioritization
- RACI
- PR Plan
- Task Breakdown
- Acceptance Criteria
- Dependency / Merge Order
- Risk Register
- Verification Strategy
- Observability Requirements

### Learning Objectives

- What must be built?
- In what order?
- What can fail?
- How will each change prove that it works?
- How quickly will remaining uncertainty become visible?
- What will we need to know once the software is running?
- Which operational questions must the implementation make answerable?

### Gate

Proceed when the next implementation increment can be designed without inventing material requirements or architectural decisions, and when the evidence required to verify its behavior before and after deployment is understood.

---

## 2.2 Design

**Objective:** Translate conceptual and logical architecture into the physical structures necessary for implementation.

Observability is part of the physical architecture.

Do not ask merely, "What can we log?" Ask, "What will we need to know, and what is the least expensive reliable evidence that will let us know it?"

### Activities

- Determine concrete components, interfaces, schemas, APIs, data flows, algorithms, and integration boundaries.
- Preserve established domain language and architectural boundaries.
- Evaluate failure, concurrency, consistency, latency, idempotency, security, maintainability, and operability where relevant.
- Identify the system states, transitions, outcomes, and failures that must be observable.
- Determine the appropriate evidence for those questions: logs, metrics, traces, events, audit records, health signals, or other instrumentation.
- Prefer signals that directly answer known operational questions over broad instrumentation intended for unspecified future analysis.
- Control cardinality, volume, retention, sampling, and verbosity deliberately.
- Avoid duplicating the same evidence across multiple observability mechanisms without a specific reason.
- Ensure important failures can be distinguished from expected or benign conditions.
- Ensure measurements have sufficiently precise semantics to support the decisions they are intended to inform.
- Consider privacy, security, and sensitive-data exposure when deciding what may be observed or retained.
- Prefer existing project conventions and observability infrastructure unless requirements justify changing them.
- Record durable architectural decisions when future work would otherwise need to rediscover their rationale.
- Use additional POCs when physical design exposes material uncertainty.

### Example Deliverables

- Wireframes
- Designs
- Physical Architecture
- Interface Definitions
- Schemas
- Sequence / Data Flows
- Observability Design
- ADRs
- POCs

### Learning Objectives

- Exactly how will the logical architecture exist in this system?
- What physical constraints affect it?
- Have implementation details exposed flaws in the logical model?
- What signals establish correct behavior?
- What signals expose important failure modes?
- Can those signals answer the questions they exist to answer?
- Is the expected observability cost proportional to its operational value?

### Gate

Proceed when implementation can occur without requiring the builder to invent consequential design decisions implicitly in code, and when required operational behavior can be observed with intentional, bounded instrumentation.

---

## 2.3 Build

**Objective:** Implement the accepted design as the smallest coherent sequence of working, verifiable changes.

Code is an execution of established intent, not permission to reinterpret it.

### Activities

- Implement according to established requirements, constraints, architecture, and project conventions.
- Keep changes scoped to the current objective.
- Implement the observability defined by the design as part of the behavior of the system.
- Preserve the intended semantics of logs, metrics, traces, events, and other operational signals.
- Do not add high-volume or high-cardinality instrumentation without a demonstrated need.
- Continuously compile, lint, test, execute, and inspect rather than postponing validation until implementation is complete.
- Test behavior, boundaries, failure modes, invariants, and important observability signals—not merely lines of code.
- Prefer deterministic tools for questions they can answer: compiler, type checker, formatter, linter, test runner, database, static analyzer, benchmark, and equivalent mechanisms.
- Treat unexpected behavior as new evidence.
- Do not modify requirements or architecture merely to make failing code pass.
- Stop and regress to Design, Plan, Conceptualize, Identify, or Evaluate when implementation reveals an invalid earlier assumption.

### Example Deliverables

- Working Software
- Tests
- Instrumentation
- Migrations
- Documentation
- Reviewable Changes

### Learning Objectives

- Does the implementation behave as designed?
- Can its important behavior be observed as designed?
- What did implementation reveal that earlier reasoning did not?
- Have any requirements, assumptions, or architectural decisions been invalidated?

### Gate

Proceed when the implementation satisfies its acceptance criteria, required deterministic verification passes, and the signals required to verify and operate the software are present and behaving as designed.

---

# 3. Deliver to Grow | Market Delight

**Goal: Market the right things and delight consumers.**

This phase distinguishes **implementation correctness** from **system and outcome correctness**.

Passing tests establishes evidence about the implementation. It does not establish that the original problem was correctly understood, that the software behaves correctly in its real environment, or that it produces the intended outcome.

---

## 3.1 Verify

**Objective:** Challenge the completed implementation against the requirements, architecture, expected behavior, and realistic operating conditions.

Verification should attempt to disprove correctness rather than merely confirm the happy path.

### Activities

- Re-evaluate the implementation against the original opportunity and success criteria.
- Execute the complete relevant verification suite.
- Test integration boundaries and realistic failure modes.
- Verify that expected logs, metrics, traces, events, and other operational signals are emitted under the conditions they are intended to represent.
- Verify that important failure modes produce sufficient evidence for diagnosis.
- Verify that instrumentation does not create unreasonable volume, cardinality, performance, storage, security, or privacy consequences.
- Inspect the resulting diff for unintended behavior and unnecessary changes.
- Verify migrations, compatibility, security, performance, rollback, and operational behavior where applicable.
- Confirm that documentation and durable decision records match the implemented system.
- Identify requirements that tests cannot establish automatically.
- Distinguish defects from newly discovered requirements or invalid assumptions.

### Example Deliverables

- Delightful Software
- Verification Evidence
- Test Results
- Observability Verification
- Review Findings
- Release Candidate

### Learning Objectives

- Did we build what we intended?
- Does it work under relevant conditions?
- Did implementation introduce unintended behavior?
- Can important production behavior and failures actually be observed?
- What remains unverified?

### Gate

Proceed when there is sufficient evidence to justify exposing the change to its intended environment or consumers, and sufficient observability exists to evaluate its behavior after release.

---

## 3.2 Launch

**Objective:** Deliver the change, observe its real behavior, and determine whether it produced the intended outcome.

Deployment is not evidence that the initiative succeeded.

Launch closes the learning loop established during Discovery and enabled by the observability designed during Focus to Implement.

### Activities

- Release according to the appropriate deployment and rollout strategy.
- Observe the signals intentionally designed into the system.
- Compare actual behavior with the expectations established during Design and Verify.
- Compare actual outcomes with the success criteria established during Discovery.
- Detect regressions, unexpected behavior, and incorrect assumptions.
- Investigate unexpected signals rather than automatically treating them as implementation defects.
- Distinguish implementation failures, operational failures, and failures of the original concept.
- Evaluate whether the available observability answered the questions it was designed to answer.
- Remove or reduce temporary or unnecessarily expensive instrumentation when its learning objective has been satisfied.
- Identify missing signals only when actual operation demonstrates a need for them.
- Feed new evidence back into the appropriate earlier stage.

### Example Deliverables

- Business Value
- Deployed Software
- Observed Outcomes
- Operational Evidence
- Follow-up Work

### Learning Objectives

- Does the software behave correctly in reality?
- Did the change produce the intended outcome?
- What does production evidence tell us about our earlier assumptions?
- Did our observability provide enough evidence to distinguish success, failure, and expected variation?
- Which instrumentation continues to justify its cost?
- What did reality teach us that development could not?

### Gate

Complete the workflow when the intended outcome is supported by sufficient evidence and the system can be operated with the required level of understanding.

If production evidence reveals an implementation defect, invalid design, incorrect assumption, misunderstood opportunity, or insufficient observability, return to the earliest stage responsible for resolving it.
