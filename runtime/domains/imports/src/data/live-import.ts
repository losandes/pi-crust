import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, rmSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { z } from 'zod'
import {
  fail,
  safeParseSettlement,
  succeed,
  type TSettlement,
} from '../../../../../lib/typedefs/src/settlement'
import { fileExists, nowIso, writeText } from '../../../../lib/system'
import { headAt, matchesHead } from '../../../workspace'
import type {
  TImportPorts,
  TIssueComment,
  TIssueSource,
} from '../typedefs/work-source'

const issueSchema = z.object({
  html_url: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  body: z
    .string()
    .nullable()
    .transform((body) => body ?? ''),
  pull_request: z.unknown().optional(),
})
const commentSchema = z.object({
  html_url: z.string(),
  user: z.object({ login: z.string() }),
  author_association: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  body: z
    .string()
    .nullable()
    .transform((body) => body ?? ''),
})
const gh = (args: readonly string[], cwd: string): TSettlement<string> => {
  const result = safeParseSettlement(() =>
    spawnSync('gh', [...args], { encoding: 'utf8', cwd }),
  )
  if (result.status === 'error')
    return fail(
      new Error(
        `gh ${args.join(' ')} exited undefined: ${result.error.message}`,
      ),
    )
  return result.data.error !== undefined || result.data.status !== 0
    ? fail(
        new Error(
          `gh ${args.join(' ')} exited ${result.data.status}: ${result.data.stderr?.trim() ?? ''}`,
        ),
      )
    : succeed(result.data.stdout)
}
const parseJson = (text: string): TSettlement<unknown> =>
  safeParseSettlement(() => JSON.parse(text))
const readIssue = (
  repository: string,
  number: number,
  cwd: string,
): TSettlement<TIssueSource> => {
  const fetched = gh(['api', `repos/${repository}/issues/${number}`], cwd)
  if (fetched.status === 'error') return fetched
  const json = parseJson(fetched.data)
  if (json.status === 'error') return json
  const issue = issueSchema.safeParse(json.data)
  if (!issue.success) return fail(issue.error)
  const base = {
    address: issue.data.html_url,
    posted_at: issue.data.created_at,
    updated_at: issue.data.updated_at,
    body: issue.data.body,
    pull_request: issue.data.pull_request !== undefined,
  }
  if (base.pull_request) return succeed({ ...base, comments: [] })
  const fetchedComments = gh(
    [
      'api',
      '--paginate',
      `repos/${repository}/issues/${number}/comments?per_page=100`,
      '--jq',
      '.[]',
    ],
    cwd,
  )
  if (fetchedComments.status === 'error') return fetchedComments
  const comments = fetchedComments.data
    .split('\n')
    .filter((line) => line.trim() !== '')
    .reduce<TSettlement<readonly TIssueComment[]>>((state, line) => {
      if (state.status === 'error') return state
      const json = parseJson(line)
      if (json.status === 'error') return json
      const comment = commentSchema.safeParse(json.data)
      if (!comment.success) return fail(comment.error)
      return succeed([
        ...state.data,
        {
          address: comment.data.html_url,
          author: comment.data.user.login,
          association: comment.data.author_association,
          posted_at: comment.data.created_at,
          edited_at: comment.data.updated_at,
          body: comment.data.body,
        },
      ])
    }, succeed([]))
  return comments.status === 'error'
    ? comments
    : succeed({ ...base, comments: comments.data })
}
export const liveImport: TImportPorts = {
  repository: (cwd) => {
    const result = gh(
      ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'],
      cwd,
    )
    return result.status === 'error' ? result : succeed(result.data.trim())
  },
  issue: readIssue,
  document: (path) => {
    if (!fileExists(path)) return fail(new Error('does not exist'))
    const stat = safeParseSettlement(() => statSync(path))
    if (stat.status === 'error') return stat
    if (!stat.data.isFile()) return fail(new Error('is not a file'))
    return safeParseSettlement(() => {
      const bytes = readFileSync(path)
      const head = headAt(dirname(path))
      return {
        text: bytes.toString('utf8'),
        sha256: createHash('sha256').update(bytes).digest('hex'),
        head,
        differs_from_head: head !== '' && !matchesHead(path),
      }
    })
  },
  exists: fileExists,
  write: (path, content) =>
    safeParseSettlement(() => {
      writeText(path, content)
    }),
  remove: (path) => safeParseSettlement(() => rmSync(path, { force: true })),
  now: nowIso,
}
