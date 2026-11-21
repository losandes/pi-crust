import { expect, test } from 'bun:test'
import { fail, succeed } from '../../../../../lib/typedefs'
import { comment, issue, memory, params, section } from '../import-fixture.test'
import type { TImportPorts } from '../typedefs/work-source'
import { importWork } from './import-work'

for (const { name, request, override, message } of [
  {
    name: 'SC8 unreadable issue S2',
    request: '#150',
    override: { issue: () => fail(new Error('not found')) },
    message: 'cannot import #150: not found',
  },
  {
    name: 'SC8 repository failure S2',
    request: '#150',
    override: { repository: () => fail(new Error('no repository')) },
    message: 'cannot import #150: no repository',
  },
  {
    name: 'SC8 two issues S1',
    request: '#1 #2',
    override: {},
    message: 'the request names 2 sources as the work to implement — #1, #2 —',
  },
  {
    name: 'SC21 issue and document S1',
    request: '#1 a.md',
    override: {},
    message:
      'the request names 2 sources as the work to implement — #1, a.md —',
  },
  {
    name: 'SC21 two documents S1',
    request: 'a.md b.md',
    override: {},
    message:
      'the request names 2 sources as the work to implement — a.md, b.md —',
  },
  {
    name: 'different repository S3',
    request: 'other/repo#1',
    override: {},
    message: 'it is in other/repo, and this run works in losandes/pi-crust',
  },
  {
    name: 'pull request S4',
    request: '#150',
    override: {
      issue: () => succeed({ ...issue('text'), pull_request: true }),
    },
    message: 'it is a pull request',
  },
  {
    name: 'SC21 missing document S5',
    request: 'missing.md',
    override: {},
    message: 'cannot import missing.md: /work/missing.md does not exist',
  },
  {
    name: 'empty source S6',
    request: '#150',
    override: { issue: () => succeed(issue('')) },
    message: 'carries no text to implement',
  },
] satisfies readonly Readonly<{
  name: string
  request: string
  override: Partial<TImportPorts>
  message: string
}>[]) {
  test(
    [
      `given ${name}`,
      'when importing',
      'it should stop without writing any file',
    ].join(', '),
    () => {
      // given
      const fixture = memory()
      // when
      const actual = importWork({ ...fixture.ports, ...override })({
        ...params,
        request,
      })
      // then
      expect(actual.status).toBe('error')
      if (actual.status === 'error')
        expect(actual.error.message).toContain(message)
      expect(fixture.writes).toEqual([])
    },
  )
}

test(
  [
    'given no reference and no earlier work',
    'when importing',
    'it should return no envelope and never resolve a repository',
  ].join(', '),
  () => {
    // given
    const fixture = memory()
    // when
    const actual = importWork({
      ...fixture.ports,
      repository: () => {
        throw new Error('must not resolve')
      },
    })({ ...params, request: 'build a feature' })
    // then
    expect(actual).toEqual(succeed(undefined))
    expect(fixture.writes).toEqual([])
  },
)

test(
  [
    'given identical issue references with different spellings',
    'when importing',
    'it should read a single source',
  ].join(', '),
  () => {
    // given
    const fixture = memory()
    // when
    const actual = importWork(fixture.ports)({
      ...params,
      request:
        '#150 LOSANDES/pi-crust#150 https://github.com/losandes/pi-crust/issues/150',
    })
    // then
    expect(actual.status).toBe('ok')
    expect(fixture.files.get('/work/handoff/plan.md')).toBe('The plan\n')
  },
)

test(
  [
    'given SC20 prompt path with question references in its contents',
    'when importing from the process cwd',
    'it should ignore the contents as references and record document provenance',
  ].join(', '),
  () => {
    // given
    const fixture = memory()
    fixture.files.set('/cwd/source.md', section('Plan', 'edited #999'))
    // when
    const actual = importWork(fixture.ports)({
      ...params,
      request: '#999',
      promptPath: 'source.md',
      cwd: '/cwd',
    })
    // then
    expect(actual.status).toBe('ok')
    if (actual.status === 'ok')
      expect(actual.data?.source).toMatchObject({
        kind: 'document',
        written: 'source.md',
        address: '/cwd/source.md',
        read_at: 'read',
        sha256: 'sha',
        head: 'head',
        differs_from_head: true,
      })
    expect(fixture.files.get('/work/handoff/plan.md')).toBe('edited #999\n')
  },
)

test(
  [
    'given SC20 duplicate document paths',
    'when resolving them against the repository',
    'it should import the on-disk text once',
  ].join(', '),
  () => {
    // given
    const fixture = memory()
    fixture.files.set('/work/source.md', 'source bytes')
    // when
    const actual = importWork(fixture.ports)({
      ...params,
      request: 'source.md ./source.md',
    })
    // then
    expect(actual.status).toBe('ok')
    expect(fixture.files.get('/work/handoff/imported-work.md')).toBe(
      'source bytes',
    )
  },
)

test(
  [
    'given a protected source',
    'when importing',
    'it should stop before reading the document',
  ].join(', '),
  () => {
    // given
    const fixture = memory()
    // when
    const actual = importWork(fixture.ports)({
      ...params,
      request: 'secret.md',
      protectedFiles: ['*.md'],
    })
    // then
    expect(actual.status).toBe('error')
    if (actual.status === 'error')
      expect(actual.error.message).toBe(
        'cannot import secret.md: /work/secret.md is protected by protected_files',
      )
    expect(fixture.writes).toEqual([])
  },
)

test(
  [
    'given an external document',
    'when protection patterns match its basename',
    'it should still read the source',
  ].join(', '),
  () => {
    // given
    const fixture = memory()
    fixture.files.set('/other/source.md', 'outside')
    // when
    const actual = importWork(fixture.ports)({
      ...params,
      request: '/other/source.md',
      protectedFiles: ['**'],
    })
    // then
    expect(actual.status).toBe('ok')
    expect(fixture.files.get('/work/handoff/imported-work.md')).toBe('outside')
  },
)

for (const removalFails of [false, true]) {
  test(
    [
      'given a failed second write with a partial file',
      `when undoing writes and removal failure is ${removalFails}`,
      'it should stop with S7 and attempt all removals',
    ].join(', '),
    () => {
      // given
      const fixture = memory(
        section('Identify', 'criteria') +
          section('Plan', 'plan') +
          section('Diagnosis', 'diagnosis'),
      )
      const ports: TImportPorts = {
        ...fixture.ports,
        write: (path, text) => {
          const result = fixture.ports.write(path, text)
          return path.endsWith('/plan.md')
            ? fail(new Error('disk full'))
            : result
        },
        remove: (path) => {
          if (removalFails && path.endsWith('/identify.md'))
            return fail(new Error('locked'))
          return fixture.ports.remove(path)
        },
      }
      // when
      const actual = importWork(ports)(params)
      // then
      expect(actual.status).toBe('error')
      if (actual.status === 'error')
        expect(actual.error.message).toBe(
          `cannot import #150: could not write /work/handoff/plan.md: disk full; removed ${removalFails ? 1 : 2} file(s) this import had written${removalFails ? '; could not remove /work/handoff/identify.md' : ''}`,
        )
      expect(fixture.files.has('/work/handoff/identify.md')).toBe(removalFails)
      expect(fixture.files.has('/work/handoff/plan.md')).toBe(false)
      expect(fixture.files.has('/work/handoff/diagnosis.md')).toBe(false)
      expect(fixture.writes).toEqual([
        '/work/handoff/identify.md',
        '/work/handoff/plan.md',
      ])
    },
  )
}

test(
  [
    'given a write that fails without creating its path',
    'when undoing',
    'it should remove only earlier files',
  ].join(', '),
  () => {
    // given
    const fixture = memory()
    // when
    const actual = importWork({
      ...fixture.ports,
      write: () => fail(new Error('denied')),
    })(params)
    // then
    expect(actual.status).toBe('error')
    expect(fixture.removes).toEqual([])
  },
)

test(
  [
    'given SC9 earlier whole-source work',
    'when the source changes',
    'it should preserve the earlier bytes and retain the new text separately',
  ].join(', '),
  () => {
    // given
    const fixture = memory('new text', [comment('answer')])
    fixture.files.set('/work/handoff/imported-work.md', 'earlier')
    // when
    const actual = importWork(fixture.ports)(params)
    // then
    expect(actual.status).toBe('ok')
    expect(fixture.files.get('/work/handoff/imported-work.md')).toBe('earlier')
    expect(
      fixture.files.get('/work/handoff/imported-unattributed.md'),
    ).toContain('new text')
  },
)
