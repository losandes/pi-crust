import type { TSettlement } from '../../../../../lib/typedefs/src/settlement'

export type TWorkReference =
  | Readonly<{
      kind: 'github-issue'
      written: string
      repository: string
      number: number
    }>
  | Readonly<{ kind: 'document'; written: string; path: string }>

export type TIssueComment = Readonly<{
  author: string
  association: string
  address: string
  posted_at: string
  edited_at: string
  body: string
}>
export type TIssueSource = Readonly<{
  address: string
  posted_at: string
  updated_at: string
  body: string
  pull_request: boolean
  comments: readonly TIssueComment[]
}>
export type TDocumentSource = Readonly<{
  text: string
  sha256: string
  head: string
  differs_from_head: boolean
}>
export type TImportPorts = Readonly<{
  repository: (cwd: string) => TSettlement<string>
  issue: (
    repository: string,
    number: number,
    cwd: string,
  ) => TSettlement<TIssueSource>
  document: (absolutePath: string) => TSettlement<TDocumentSource>
  exists: (absolutePath: string) => boolean
  write: (absolutePath: string, content: string) => TSettlement<void>
  remove: (absolutePath: string) => TSettlement<void>
  now: () => string
}>
