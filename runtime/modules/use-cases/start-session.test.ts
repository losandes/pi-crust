import { expect, test } from 'bun:test'
import { basename } from 'node:path'
import { sessionLifecycle } from './start-session'

/** What the fallback resolves to in whatever process is running the suite. */
const scriptName = (): string =>
  basename(process.argv[1] ?? 'crust').replace(/\.ts$/, '')

test(
  [
    'given use-cases/start-session::sessionLifecycle',
    'when the run was asked for a Lifecycle by name',
    'it should record that name, not the script that happened to run it',
  ].join(', '),
  () => {
    /*
     * given — nearly every run goes through `compose.ts`, so the script name
     * made `sdlc`, `tdd` and `bugfix` all read as `compose` on the dashboard:
     * one word for every run, naming the mechanism rather than the work.
     */
    const given = 'sdlc'

    // when
    const actual = sessionLifecycle(given)

    // then
    expect(actual).toEqual('sdlc')
  },
)

test(
  [
    'given use-cases/start-session::sessionLifecycle',
    'when the chain was spelled out at the call site instead of named',
    'it should fall back to the script name, because there is no name to give',
  ].join(', '),
  () => {
    // given — `--activities plan,build` names no Lifecycle
    const given = undefined

    // when
    const actual = sessionLifecycle(given)

    // then
    expect(actual).toEqual(scriptName())
  },
)

test(
  [
    'given use-cases/start-session::sessionLifecycle',
    'when the flag was present but empty',
    'it should read as no Lifecycle rather than record a blank name',
  ].join(', '),
  () => {
    // given
    const given = ''

    // when
    const actual = sessionLifecycle(given)

    // then
    expect(actual).toEqual(scriptName())
  },
)
