import { expect, test } from 'bun:test'
import type { TBaseRef } from '../../../../lib/contracts'
import type { TRangeGit } from './select-range'
import {
  requireSelected,
  selectedPathsWith,
  selectRangeWith,
} from './select-range'

/**
 * A git surface that answers from the test's own facts.
 *
 * Injected rather than driven from a scratch repository: these cases are about
 * which git question gets asked, which is a decision this module makes and a
 * temp repo would only obscure.
 */
const gitWith = (facts: Readonly<Partial<TRangeGit>>): TRangeGit => ({
  refExists: () => true,
  shortSha: (ref) => ref.slice(0, 7),
  changedFiles: () => [],
  untrackedFiles: () => [],
  diffFiles: () => [],
  diffFilesBetween: () => [],
  mergeBase: (ref) => ref,
  filesUnder: () => [],
  resolveBase: (ref): TBaseRef => ({
    ref,
    commit: ref,
    reason: `HEAD is ahead of ${ref} — diffing every commit since`,
  }),
  ...facts,
})

test(
  [
    'given use-cases/select-range::selectRange',
    'when no base was given',
    'it should report the uncommitted working tree and say so in the reason',
  ].join(', '),
  () => {
    // given
    const git = gitWith({
      changedFiles: () => ['src/b.ts', ''],
      untrackedFiles: () => ['src/a.ts'],
    })

    // when
    const actual = selectRangeWith(git)('')

    // then
    expect(actual.paths).toEqual(['src/a.ts', 'src/b.ts'])
    expect(actual.reason).toEqual(
      'no base given — the uncommitted working tree',
    )
  },
)

test(
  [
    'given use-cases/select-range::selectRange',
    'when a two-dot range is given',
    'it should diff the two commits and leave untracked files out',
  ].join(', '),
  () => {
    // given
    const git = gitWith({
      diffFilesBetween: (from, to, symmetric) =>
        symmetric ? ['wrong.ts'] : [`${from}-${to}.ts`],
    })

    // when
    const actual = selectRangeWith(git)('main..HEAD')

    // then
    expect(actual.paths).toEqual(['main-HEAD.ts'])
    expect(actual.reason).toEqual('every commit from main to HEAD')
  },
)

test(
  [
    'given use-cases/select-range::selectRange',
    'when a three-dot range is given',
    'it should ask git for the symmetric difference and name the merge base',
  ].join(', '),
  () => {
    // given
    const git = gitWith({
      diffFilesBetween: (_from, _to, symmetric) =>
        symmetric ? ['src/a.ts'] : ['wrong.ts'],
      mergeBase: () => 'abcdef1234',
    })

    // when
    const actual = selectRangeWith(git)('main...HEAD')

    // then
    expect(actual.paths).toEqual(['src/a.ts'])
    expect(actual.reason).toEqual(
      'commits on HEAD since it diverged from main (abcdef1)',
    )
  },
)

test(
  [
    'given use-cases/select-range::selectRange',
    'when a single ref is given',
    'it should route through resolveBase and keep the reason it decided on',
  ].join(', '),
  () => {
    // given
    const git = gitWith({
      diffFiles: (base) => [`${base}.ts`],
      untrackedFiles: () => ['new.ts'],
    })

    // when
    const actual = selectRangeWith(git)('HEAD~1')

    // then
    expect(actual.paths).toEqual(['HEAD~1.ts', 'new.ts'])
    expect(actual.reason).toEqual(
      'HEAD is ahead of HEAD~1 — diffing every commit since',
    )
  },
)

test(
  [
    'given use-cases/select-range::selectRange',
    'when an endpoint of a range does not resolve',
    'it should throw naming the ref and what to pass instead',
  ].join(', '),
  () => {
    // given
    const git = gitWith({ refExists: (ref) => ref !== 'nope' })

    // when, then
    expect(() => selectRangeWith(git)('nope...HEAD')).toThrow(
      /base ref 'nope' in 'nope\.\.\.HEAD' does not exist/,
    )
  },
)

test(
  [
    'given use-cases/select-range::selectedPaths',
    'when an explicit base selects no changed file',
    'it should throw rather than let every check pass vacuously',
  ].join(', '),
  () => {
    // given
    const git = gitWith({ diffFilesBetween: () => [] })

    // when, then
    expect(() => selectedPathsWith(git)('main...HEAD')).toThrow(
      /--base 'main\.\.\.HEAD' selects no changed file/,
    )
  },
)

test(
  [
    'given use-cases/select-range::requireSelected',
    'when no base was given and the working tree is clean',
    'it should return an empty list, because an empty tree is a real answer',
  ].join(', '),
  () => {
    // given
    const selection = selectRangeWith(gitWith({}))('')

    // when
    const actual = requireSelected(selection)

    // then
    expect(actual).toEqual([])
  },
)

test(
  [
    'given use-cases/select-range::selectRangeWith',
    'when the scope names a directory rather than a ref',
    'it should select every tracked file under it, however old',
  ].join(', '),
  () => {
    // given a path nothing has touched recently
    const git = gitWith({
      refExists: () => false,
      filesUnder: () => ['apps/gateway/b.ts', 'apps/gateway/a.ts'],
      diffFiles: () => ['somewhere/else.ts'],
    })

    // when
    const actual = selectRangeWith(git)('apps/gateway')

    // then — a range cannot express this, which is why the scope exists
    expect(actual.paths).toEqual(['apps/gateway/a.ts', 'apps/gateway/b.ts'])
    expect(actual.reason).toContain('whenever it was committed')
  },
)

test(
  [
    'given use-cases/select-range::selectRangeWith',
    'when a ref and a directory share a name',
    'it should read it as the ref',
  ].join(', '),
  () => {
    // given `main` exists as a branch AND as a directory
    const git = gitWith({
      refExists: (ref) => ref === 'main',
      filesUnder: () => ['main/a.ts'],
      diffFiles: () => ['changed.ts'],
    })

    // when
    const actual = selectRangeWith(git)('main')

    // then — `--base main` meant a ref first and must not change meaning
    expect(actual.paths).toEqual(['changed.ts'])
  },
)

test(
  [
    'given use-cases/select-range::selectRangeWith',
    'when the scope is a glob',
    'it should select what git matches rather than guessing at the filesystem',
  ].join(', '),
  () => {
    // given
    const git = gitWith({
      refExists: () => false,
      filesUnder: () => ['lib/one.ts', 'lib/two.ts'],
    })

    // when
    const actual = selectRangeWith(git)('lib/**/*.ts')

    // then
    expect(actual.paths).toEqual(['lib/one.ts', 'lib/two.ts'])
  },
)

test(
  [
    'given use-cases/select-range::selectRangeWith',
    'when a single ref is given and diffFiles/filesUnder are left at their defaults',
    'it should still fall through to resolveBase without blowing up',
  ].join(', '),
  () => {
    // given
    const git = gitWith({})

    // when
    const actual = selectRangeWith(git)('HEAD~1')

    // then
    expect(actual.paths).toEqual([])
  },
)

test(
  [
    'given use-cases/select-range::requireSelected',
    'when a directory scope matches no tracked file',
    'it should refuse, because an empty scope is not a clean bill of health',
  ].join(', '),
  () => {
    // given
    const git = gitWith({ refExists: () => false, filesUnder: () => [] })
    const selection = selectRangeWith(git)('apps/does-not-exist')

    // when
    const selecting = (): readonly string[] => requireSelected(selection)

    // then
    expect(selecting).toThrow()
  },
)
