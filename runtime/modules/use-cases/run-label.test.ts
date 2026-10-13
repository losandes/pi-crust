import { expect, test } from 'bun:test'
import { displayLabel, RUN_NAME_MAX, runLabel, runName } from './run-label'

test(
  [
    'given use-cases/run-label::runLabel',
    'when a name was given',
    'it should prefer the name over the lifecycle',
  ].join(', '),
  () => {
    expect(runLabel('payments rewrite', 'sdlc')).toEqual('payments rewrite')
  },
)

test(
  [
    'given use-cases/run-label::runLabel',
    'when no name was given',
    'it should fall back to the lifecycle',
  ].join(', '),
  () => {
    expect(runLabel('', 'sdlc')).toEqual('sdlc')
  },
)

test(
  [
    'given use-cases/run-label::displayLabel',
    'when the label is longer than 48 characters',
    'it should clip it for display, without touching what would be stored',
  ].join(', '),
  () => {
    // given
    const long = 'a'.repeat(60)

    // when
    const actual = displayLabel(long, 'sdlc')

    // then
    expect(actual.length).toBeLessThanOrEqual(48)
    expect(runLabel(long, 'sdlc')).toEqual(long)
  },
)

test(
  [
    'given use-cases/run-label::runName',
    'when the value contains a newline',
    'it should refuse rather than store a label that breaks one terminal line',
  ].join(', '),
  () => {
    expect(() => runName('two\nlines')).toThrow()
  },
)

test(
  [
    'given use-cases/run-label::runName',
    'when the value is one character over the limit',
    'it should refuse rather than silently shorten it',
  ].join(', '),
  () => {
    expect(() => runName('a'.repeat(RUN_NAME_MAX + 1))).toThrow()
  },
)

test(
  [
    'given use-cases/run-label::runName',
    'when the flag is absent',
    'it should pass undefined through unchanged',
  ].join(', '),
  () => {
    expect(runName(undefined)).toBeUndefined()
  },
)

test(
  [
    'given use-cases/run-label::runName',
    'when the value is valid',
    'it should return it verbatim',
  ].join(', '),
  () => {
    expect(runName('payments rewrite')).toEqual('payments rewrite')
  },
)
