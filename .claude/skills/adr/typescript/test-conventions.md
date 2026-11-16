# Test Conventions

## Status

accepted

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
