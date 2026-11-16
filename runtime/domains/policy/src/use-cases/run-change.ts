import { resolve, sep } from 'node:path'
import { z } from 'zod'
import type { TSettlement } from '../../../../../lib/typedefs/src/settlement'
import { safeParseSettlement } from '../../../../../lib/typedefs/src/settlement'
import type { TRun } from '../../../../lib/contracts'
import type { TRoots, TTreeSnapshot } from '../../../workspace'
import { changedPaths } from './enforce-permissions'

export const RUN_START = 'run_start'

export const runStartSchema = z.object({
  head: z.string().min(1),
  tree: z.record(z.string(), z.string()),
})

export type TRunStart = Readonly<z.infer<typeof runStartSchema>>
export type TRunChangePorts = Readonly<{
  rev: (ref: string) => string
  content: (roots: TRoots, base: string) => TSettlement<TTreeSnapshot>
}>
export type TRunChange = Readonly<{ head: string; paths: readonly string[] }>

export const runStartIn = (
  run: Readonly<Pick<TRun, 'runId' | 'tracer'>>,
): TRunStart | undefined =>
  run.tracer
    .eventsNamed(run.runId, RUN_START)
    .map((payload) => runStartSchema.safeParse(payload))
    .find((parsed) => parsed.success)?.data

export const recordRunStart =
  (ports: TRunChangePorts) =>
  (
    run: Readonly<Pick<TRun, 'runId' | 'tracer' | 'repoRoot' | 'vcsRoot'>>,
    activityRunId: string,
  ): void => {
    if (runStartIn(run) !== undefined) return
    const revision = safeParseSettlement(() => ports.rev('HEAD'))
    if (revision.status === 'error' || revision.data === '') return
    const head = revision.data
    const content = ports.content(
      { workspaceRoot: run.repoRoot, vcsRoot: run.vcsRoot },
      head,
    )
    if (content.status === 'error') return
    run.tracer.event({
      run_id: run.runId,
      activity_run_id: activityRunId,
      type: 'log',
      name: RUN_START,
      payload: { head, tree: content.data },
    })
  }

export const runChange =
  (ports: Readonly<Pick<TRunChangePorts, 'content'>>) =>
  (
    run: Readonly<
      Pick<
        TRun,
        | 'runId'
        | 'tracer'
        | 'repoRoot'
        | 'vcsRoot'
        | 'sessionDir'
        | 'contextHandoffDir'
      >
    >,
  ): TRunChange | undefined => {
    const start = runStartIn(run)
    if (start === undefined) return undefined
    const now = ports.content(
      { workspaceRoot: run.repoRoot, vcsRoot: run.vcsRoot },
      start.head,
    )
    if (now.status === 'error') {
      throw new Error(
        `cannot read the run's change from ${start.head}; name the change with --scope: ${now.error.message}`,
      )
    }
    const excluded = [run.sessionDir, run.contextHandoffDir].map((path) =>
      resolve(path),
    )
    const paths = changedPaths(start.tree, now.data)
      .filter((path) => {
        const absolute = resolve(run.repoRoot, path)
        return !excluded.some(
          (directory) =>
            absolute === directory || absolute.startsWith(`${directory}${sep}`),
        )
      })
      .toSorted()
    return paths.length === 0 ? undefined : { head: start.head, paths }
  }

export const runChangeBase = (head: string): string =>
  `${head} (HEAD when this run started). \`changed_files\` lists every file this run has changed since then, committed or not. Read each one with \`git diff ${head} -- <path>\`. A path that prints no diff is not tracked by git yet, or no longer exists: read the file itself.`
