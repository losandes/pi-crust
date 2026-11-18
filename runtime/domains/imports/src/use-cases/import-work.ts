import { isAbsolute, relative, resolve } from 'node:path'
import {
  fail,
  succeed,
  type TSettlement,
} from '../../../../../lib/typedefs/src/settlement'
import type {
  TActivityConfig,
  TImportOutput,
  TImportSource,
} from '../../../../lib/contracts'
import { matchesPattern } from '../../../policy'
import type { TImportPorts, TWorkReference } from '../typedefs/work-source'
import { findWorkReferences } from './find-work-references'
import { planImport, type TImportPlan } from './plan-import'

export type TImportParams = Readonly<{
  request: string
  promptPath: string | undefined
  cwd: string
  repoRoot: string
  handoffDir: string
  activities: readonly TActivityConfig[]
  protectedFiles: readonly string[]
  chain: readonly string[]
}>
const emptySource: TImportSource = {
  kind: 'handoff',
  written: '',
  address: '',
  read_at: '',
  updated_at: '',
  sha256: '',
  head: '',
  differs_from_head: false,
}
const stop = (refs: string, message: string) =>
  fail(new Error(`cannot import ${refs}: ${message}`))
const writePlan = (
  ports: TImportPorts,
  refs: string,
  plan: TImportPlan,
): TSettlement<TImportOutput | undefined> => {
  const write = (
    at: number,
    written: readonly string[],
  ): TSettlement<TImportOutput | undefined> => {
    const next = plan.writes[at]
    if (next === undefined) return succeed(plan.record)
    const result = ports.write(next.path, next.content)
    if (result.status === 'ok') return write(at + 1, [...written, next.path])
    const removals = [
      ...written.toReversed(),
      ...(ports.exists(next.path) ? [next.path] : []),
    ]
    const cleaned = removals.map((path) => ({
      path,
      result: ports.remove(path),
    }))
    const failed = cleaned
      .filter((item) => item.result.status === 'error')
      .map((item) => item.path)
    return stop(
      refs,
      `could not write ${next.path}: ${result.error.message}; removed ${cleaned.length - failed.length} file(s) this import had written${failed.length === 0 ? '' : `; could not remove ${failed.join(', ')}`}`,
    )
  }
  return write(0, [])
}

export const importWork =
  (ports: TImportPorts) =>
  (params: TImportParams): TSettlement<TImportOutput | undefined> => {
    const references = findWorkReferences(params.request, params.promptPath)
    const refs = references.map((reference) => reference.written).join(', ')
    const repository = references.some(
      (reference) => reference.kind === 'github-issue',
    )
      ? ports.repository(params.repoRoot)
      : succeed('')
    if (repository.status === 'error')
      return stop(refs, repository.error.message)
    const documentPath = (
      reference: Extract<TWorkReference, { kind: 'document' }>,
    ): string =>
      resolve(
        params.promptPath !== undefined &&
          /\.(md|markdown)$/i.test(params.promptPath)
          ? params.cwd
          : params.repoRoot,
        reference.path,
      )
    const keys = references.map((reference) =>
      reference.kind === 'document'
        ? documentPath(reference)
        : `${(reference.repository || repository.data).toLowerCase()}#${reference.number}`,
    )
    const distinct = new Set(keys).size
    if (distinct > 1)
      return fail(
        new Error(
          `the request names ${distinct} sources as the work to implement — ${refs} — and this run will not choose between them. Reword the request so exactly one remains, or run a chain without 'import'.`,
        ),
      )
    const reference = references[0]
    const plan = (
      source: TImportSource,
      body: Parameters<typeof planImport>[0]['body'],
      comments: Parameters<typeof planImport>[0]['comments'],
    ): TSettlement<TImportOutput | undefined> => {
      const planned = planImport({
        source,
        body,
        comments,
        activities: params.activities,
        chain: params.chain,
        repoRoot: params.repoRoot,
        handoffDir: params.handoffDir,
        exists: ports.exists,
      })
      if (reference !== undefined && planned.record === undefined)
        return stop(refs, `${source.address} carries no text to implement`)
      return writePlan(ports, refs, planned)
    }
    if (reference === undefined) return plan(emptySource, undefined, [])
    if (reference.kind === 'github-issue') {
      if (
        reference.repository !== '' &&
        reference.repository.toLowerCase() !== repository.data.toLowerCase()
      )
        return stop(
          refs,
          `it is in ${reference.repository}, and this run works in ${repository.data} — only issues in this repository are imported`,
        )
      const issue = ports.issue(
        repository.data,
        reference.number,
        params.repoRoot,
      )
      if (issue.status === 'error') return stop(refs, issue.error.message)
      const readAt = ports.now()
      if (issue.data.pull_request)
        return stop(
          refs,
          'it is a pull request, and pull requests are not imported',
        )
      return plan(
        {
          ...emptySource,
          kind: 'github-issue',
          written: reference.written,
          address: issue.data.address,
          read_at: readAt,
          updated_at: issue.data.updated_at,
        },
        {
          address: issue.data.address,
          posted_at: issue.data.posted_at,
          text: issue.data.body,
        },
        issue.data.comments,
      )
    }
    const path = documentPath(reference)
    const rel = relative(params.repoRoot, path)
    if (
      !isAbsolute(rel) &&
      rel !== '..' &&
      !rel.startsWith('../') &&
      params.protectedFiles.some((pattern) => matchesPattern(rel, pattern))
    )
      return stop(refs, `${path} is protected by protected_files`)
    const document = ports.document(path)
    if (document.status === 'error')
      return stop(refs, `${path} ${document.error.message}`)
    const readAt = ports.now()
    return plan(
      {
        ...emptySource,
        sha256: document.data.sha256,
        head: document.data.head,
        differs_from_head: document.data.differs_from_head,
        kind: 'document',
        written: reference.written,
        address: path,
        read_at: readAt,
      },
      { address: path, posted_at: '', text: document.data.text },
      [],
    )
  }
