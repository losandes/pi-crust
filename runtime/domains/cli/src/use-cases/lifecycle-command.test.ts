import { expect, test } from 'bun:test'
import { safeParseSettlement } from '../../../../../lib/typedefs'
import { lifecycleCommandArgs } from './lifecycle-command'
import { lifecycleUsage, parseCli } from './parse-cli'

for (const typed of [
  ['x'],
  ['x', '--lifecycle', 'ship'],
  ['x', '--name', '--lifecycle'],
  ['x', '--lifecycle', 'bugfix', '-l=ship'],
]) {
  test(
    [
      `given ship arguments ${typed.join(' ')}`,
      'when validated',
      'it should return only the pinned selection',
    ].join(', '),
    () => {
      // given
      // when
      const actual = lifecycleCommandArgs('ship', 'ship', typed)
      // then
      expect(actual).toEqual({ status: 'ok', data: ['--lifecycle', 'ship'] })
    },
  )
}

for (const typed of [[], ['x', '--frob'], ['x', '--name']]) {
  test(
    [
      `given invalid ship arguments ${typed.join(' ')}`,
      'when validated',
      'it should preserve the parser failure',
    ].join(', '),
    () => {
      // given
      const expected = safeParseSettlement(() =>
        parseCli(typed, 'ship', lifecycleUsage('ship', 'ship')),
      )
      // when
      const actual = lifecycleCommandArgs('ship', 'ship', typed)
      // then
      expect(actual).toEqual(expected)
    },
  )
}

for (const selection of [
  ['--lifecycle', 'bugfix'],
  ['--lifecycle=bugfix'],
  ['-l', 'bugfix'],
  ['-l=bugfix'],
  ['--lifecycle', 'bugfix', '--activities', 'plan,build'],
]) {
  test(
    [
      `given ship with ${selection.join(' ')}`,
      'when validated',
      'it should explain the lifecycle conflict first',
    ].join(', '),
    () => {
      // given
      // when
      const actual = lifecycleCommandArgs('ship', 'ship', ['x', ...selection])
      // then
      expect(actual.status === 'error' && actual.error.message).toBe(
        'crust ship: --lifecycle bugfix conflicts with this command, which always runs the ship Lifecycle. Run `crust run "<prompt>" --lifecycle bugfix` instead.',
      )
    },
  )
}

for (const selection of [
  ['--activities', 'plan,build'],
  ['--activities=plan,build'],
  ['-a', 'plan,build'],
  ['-a=plan,build'],
  ['--lifecycle', 'ship', '-a', 'plan,build'],
]) {
  test(
    [
      `given ship with ${selection.join(' ')}`,
      'when validated',
      'it should explain the Activities conflict',
    ].join(', '),
    () => {
      // given
      // when
      const actual = lifecycleCommandArgs('ship', 'ship', ['x', ...selection])
      // then
      expect(actual.status === 'error' && actual.error.message).toBe(
        'crust ship: a lifecycle and a list of Activities cannot both be given. This command always runs the ship Lifecycle; got --activities plan,build. Run `crust run "<prompt>" --activities plan,build` instead.',
      )
    },
  )
}
