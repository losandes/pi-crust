import { expect, test } from 'bun:test'
import { importOutputSchema } from '../../../../lib/contracts'
import { comment, memory, params } from '../import-fixture.test'
import { importWork } from './import-work'
import { renderImportReport } from './render-import-report'

test(
  [
    'given SC7 and SC19 imported work and comments',
    'when rendering the import report',
    'it should show all provenance and placement fields',
  ].join(', '),
  () => {
    // given
    const fixture = memory(undefined, [
      comment('answer'),
      comment('context', { association: 'NONE', address: 'second' }),
    ])
    const result = importWork(fixture.ports)(params)
    expect(result.status).toBe('ok')
    if (result.status !== 'ok' || result.data === undefined) return
    // when
    const actual = renderImportReport(result.data).join('\n')
    // then
    for (const field of [
      '#150',
      'issue',
      'read',
      'updated',
      'handoff/plan.md',
      'imported',
      'used',
      'created',
      '@alice',
      'MEMBER',
      'comment',
      'posted',
      'edited',
      'appended',
      'untrusted-author',
      'second',
    ])
      expect(actual).toContain(field)
  },
)

test(
  [
    'given document provenance',
    'when rendering it',
    'it should show digest commit and dirty state',
  ].join(', '),
  () => {
    // given
    const record = importOutputSchema.parse({
      status: 'success',
      source: {
        kind: 'document',
        written: 'source.md',
        address: '/source.md',
        read_at: 'now',
        sha256: 'digest',
        head: 'commit',
        differs_from_head: true,
      },
      documents: [
        {
          activity: 'plan',
          document: 'plan.md',
          status: 'present',
          address: '',
          versions: [{ address: 'old', posted_at: 'then', used: false }],
          appended: [],
        },
      ],
      unattributed: [
        { label: 'Unknown', address: 'source', reason: 'unknown-label' },
      ],
    })
    // when
    const actual = renderImportReport(record).join('\n')
    // then
    for (const field of [
      'digest',
      'commit',
      'differs from HEAD: true',
      'present',
      'not used old',
      'Unknown',
    ])
      expect(actual).toContain(field)
  },
)
