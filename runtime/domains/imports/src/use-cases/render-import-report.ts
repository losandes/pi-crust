import type { TImportOutput } from '../../../../lib/contracts'

export const renderImportReport = (
  record: TImportOutput,
): readonly string[] => [
  `import ${record.source.written} — ${record.source.address} (read ${record.source.read_at})`,
  ...(record.source.kind === 'github-issue'
    ? [`  issue updated ${record.source.updated_at}`]
    : []),
  ...(record.source.kind === 'document'
    ? [
        `  SHA-256 ${record.source.sha256}; HEAD ${record.source.head}; differs from HEAD: ${record.source.differs_from_head}`,
      ]
    : []),
  ...record.documents.flatMap((document) => [
    `  ${document.document}: ${document.status}; text from ${document.address}`,
    ...document.versions.map(
      (version) =>
        `    ${version.used ? 'used' : 'not used'} ${version.address} (posted ${version.posted_at})`,
    ),
  ]),
  ...record.comments.map(
    (comment) =>
      `  comment @${comment.author} (${comment.association}) ${comment.address}: posted ${comment.posted_at}, last edited ${comment.edited_at}; ${comment.placement}${comment.reason === '' ? '' : ` (${comment.reason})`} ${comment.documents.join(', ')}`,
  ),
  ...record.unattributed.map(
    (item) =>
      `  unattributed ${item.address}: ${item.label === '' ? '' : `${item.label}, `}${item.reason}`,
  ),
]
