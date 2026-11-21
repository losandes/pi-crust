# Test Conventions

## Status

accepted

## Test classification and suite boundaries

Classify a test by the effects it actually exercises, including effects in setup, helpers and default dependencies. Its filename, the number of collaborating modules and the use of fake inputs do not determine its classification.

Tests that drive a real browser, create or mutate a Git repository, launch a runtime or fixture subprocess, call an external service, or rely on long wall-clock waits belong to the integration suite. A controlled or fake executable still starts a real process; testing its launch, exit status or signal handling exercises a process boundary.

Keep integration tests out of the default fast suite and available through an explicit integration opt-in. Replacing a real boundary with injected values can make a test isolated; supplying fake data to a real executable does not remove that boundary. Cheap local temporary files, disposable local SQLite and collaboration between modules do not automatically make a test an integration test.

## Choose the cheapest sufficient test

Use the least expensive test that can reliably detect the regression. Test pure transformations and diagnostic formatting directly from inputs and outputs, without starting processes or browsers. Keep targeted integration coverage for behavior that depends on actual process launch, termination, browser rendering or Git operations.

Do not add expensive setup merely to raise coverage, or remove meaningful integration assertions merely to make the suite faster. Separate pure decisions from boundary execution so each can be tested at the level needed to establish its behavior.

## File name conventions

Test files should be named using the following convention: `*.test.ts` or `*.test.tsx`.

## Example Test

When I ask you to write tests, use the following test as an example for syntax and formatting:

```ts
import { test, expect } from 'bun:test'
import { add } from './math.ts'

test([
  'given math::add',
  'when adding 1 and 2',
  'it should return 3',
].join(', '), () => {
  // given
  const a = 1
  const b = 2

  // when
  const actual = add(a, b)

  // then
  expect(actual).toEqual(3)
})
```

## Instructions

- Generate positive and negative path tests, including error conditions and edge cases
- Never use describe
- Use the test harness built into bun
- Run tests in claude mode with logs turned off to save tokens (e.g. `pnpm test:claude` or `CLAUDECODE=1 LOG_LEVEL_MIN=silent METRICS_LEVEL_MIN=silent bun test src/domains/books/src/data/ --verbose --bail`)
- Never use beforeEach or afterEach - that breaks functional programming rules (shared state)
- Never use beforeAll either, and use afterAll only for one purpose: closing an expensive process, such as a browser or a dev server, that the test file started once at module scope. Each test must still reach that process through a handle it opens and closes itself, such as its own browser context, so no test can see another's state. Starting such a process for every test costs more than the test does, and when files run in parallel that cost becomes timeouts. Put a `// shared-process: <reason>` comment on the line directly above the afterAll; the checker accepts no other lifecycle hook
- Ensure tests are deterministic and can run in any order
- Test inputs and outputs, not implementation details
- NEVER test logging calls
- Only mock dependencies that can't be controlled and only mock what we need for the tests that are in scope. We don't need to mock features we aren't using or testing.
- Seperate the test code into sections with comments for given, when, and then. In the test description, describe the test like 'given ..., when ..., it should ...' and seperate 'given', 'when', and 'it should' descriptions into separate lines using an array that is joined with ', '.
- Ensure tests are maintainable and well-documented
- Maintain good test coverage without over-testing trivial code
- Follow functional programming best-practices
- Use existing fixtures to avoid redundant mocks when possible
- NEVER overwrite a global (e.g. global.setTimeout). If you think you need to do that to gain coverage, it's either an indication that the implementation is non-deterministic, which we should fix, or you're making bad decisions in the test. Ask the developer for help if you need to.
