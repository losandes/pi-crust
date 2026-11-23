import { fail, succeed } from '../../../../lib/typedefs'
import { importSourceSchema } from '../../../lib/contracts'
import { shippedConfig } from '../../../testing/shipped-layer'
import type {
  TImportPorts,
  TIssueComment,
  TIssueSource,
} from './typedefs/work-source'
import type { TImportParams } from './use-cases/import-work'

export const activities = shippedConfig().activities
export const section = (label: string, text: string) =>
  `---\n> _Handoff: ${label}_\n---\n\n${text}\n`
export const end = '---\n> _End of handoffs_\n---\n'
export const source = importSourceSchema.parse({
  kind: 'github-issue',
  written: '#150',
  address: 'issue',
  read_at: 'read',
  updated_at: 'updated',
})
export const comment = (
  body: string,
  overrides: Partial<TIssueComment> = {},
): TIssueComment => ({
  author: 'alice',
  association: 'MEMBER',
  address: 'comment',
  posted_at: 'posted',
  edited_at: 'edited',
  body,
  ...overrides,
})
export const issue = (
  body: string,
  comments: readonly TIssueComment[] = [],
): TIssueSource => ({
  address: 'issue',
  posted_at: 'created',
  updated_at: 'updated',
  body,
  comments,
  pull_request: false,
})
export const params: TImportParams = {
  request: '#150',
  promptPath: undefined,
  cwd: '/work',
  repoRoot: '/work',
  handoffDir: '/work/handoff',
  activities,
  protectedFiles: [],
  chain: ['build'],
}
export const memory = (
  body = section('Plan', 'The plan'),
  comments: readonly TIssueComment[] = [],
) => {
  const files = new Map<string, string>()
  const writes = new Set<string>()
  const removes = new Set<string>()
  const ports: TImportPorts = {
    repository: () => succeed('losandes/pi-crust'),
    issue: () => succeed(issue(body, comments)),
    document: (path) =>
      files.has(path)
        ? succeed({
            text: files.get(path) ?? '',
            sha256: 'sha',
            head: 'head',
            differs_from_head: true,
          })
        : fail(new Error('does not exist')),
    exists: (path) => files.has(path),
    write: (path, text) => {
      writes.add(path)
      files.set(path, text)
      return succeed(undefined)
    },
    remove: (path) => {
      removes.add(path)
      files.delete(path)
      return succeed(undefined)
    },
    now: () => 'read',
  }
  return {
    files,
    get writes() {
      return [...writes]
    },
    get removes() {
      return [...removes]
    },
    ports,
  }
}
