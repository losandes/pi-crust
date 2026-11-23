import { isAbsolute, relative, resolve } from 'node:path'
import type {
  TActivity,
  TActivityContext,
  TRun,
  TUnit,
} from '../../../../lib/contracts'
import { violationsOf } from '../../../../lib/contracts'
import { observationsIn, runStartIn, touchedBy } from '../../../policy'
import type {
  TTaskContribution,
  TTaskMoment,
  TTasksOutcome,
} from '../../../tasks'
import { changeReport, liveTaskPorts, runTasks } from '../../../tasks'
import type { TTaskRowLookup } from './change-tasks'
import { evaluationArtifact, recordTaskCommands, rowFor } from './change-tasks'

export type TWriter = Readonly<{
  instance: string
  activity: string
  activityRunId: string
}>
export type TMomentVerdict =
  | Readonly<{ kind: 'pass' }>
  | Readonly<{
      kind: 'fail'
      moment: 'deliver' | 'before'
      tasks: readonly string[]
      violations: readonly string[]
      writer: TWriter
    }>
export type TMoments = Readonly<{
  before: (stage: readonly TActivity[]) => Promise<TMomentVerdict>
  after: (
    stage: readonly TActivity[],
    excluded?: readonly string[],
  ) => Promise<ReadonlyMap<string, Readonly<{ violations: readonly string[] }>>>
  deliver: (ctx: TActivityContext) => Promise<TMomentVerdict>
}>

export const destinationOf =
  (run: TRun, units: readonly TUnit[]) =>
  (
    writer: TWriter,
  ): Readonly<{ unit: number; activity: TActivity }> | undefined => {
    const tags = new Map(
      run.tracer
        .eventsNamed(run.runId, 'chain_run')
        .flatMap((tag) =>
          typeof tag.activity_run_id === 'string' &&
          typeof tag.instance === 'string'
            ? [[tag.activity_run_id, tag.instance] as const]
            : [],
        ),
    )
    const rows = run.tracer.activityRunsFor(run.runId)
    const own = rows.find((row) => row.activity_run_id === writer.activityRunId)
    if (own === undefined) return undefined
    const destinations = units.flatMap((unit, index) =>
      unit.activities.map((activity) => ({ unit: index, activity })),
    )
    const known = tags.get(own.activity_run_id)
    if (known !== undefined)
      return destinations.find(({ activity }) => activity.instance === known)
    const earlier = rows
      .filter((row) => row.seq < own.seq)
      .toSorted((a, b) => b.seq - a.seq)
    const boundary = earlier.flatMap((row) => {
      const instance = tags.get(row.activity_run_id)
      const found = destinations.find(
        ({ activity }) => activity.instance === instance,
      )
      return found === undefined ? [] : [found]
    })[0]
    return boundary === undefined
      ? undefined
      : destinations.findLast(
          ({ unit, activity }) =>
            unit <= boundary.unit && activity.name === writer.activity,
        )
  }

const outside = (directory: string, path: string): boolean => {
  const from = relative(directory, path)
  return from === '..' || from.startsWith('../') || isAbsolute(from)
}

const repositoryPaths =
  (run: TRun) =>
  (paths: readonly string[]): readonly string[] =>
    paths
      .map((path) => resolve(run.repoRoot, path))
      .filter(
        (path) =>
          outside(run.sessionDir, path) && outside(run.contextHandoffDir, path),
      )
      .map((path) => relative(run.vcsRoot, path))

export const runChangedPaths = (run: TRun): readonly string[] => [
  ...new Set(
    observationsIn(run).flatMap((observed) =>
      repositoryPaths(run)(observed.touched),
    ),
  ),
]

export const lastWriter = (run: TRun): TWriter | undefined => {
  const observed = observationsIn(run).findLast(
    (one) => repositoryPaths(run)(one.touched).length > 0,
  )
  return observed === undefined
    ? undefined
    : {
        instance: observed.activity,
        activity: observed.agent,
        activityRunId: observed.activityRunId,
      }
}

export const persistedRowFor =
  (run: TRun): TTaskRowLookup =>
  (instance) =>
    run.tracer
      .activityRunsFor(run.runId)
      .findLast((row) => row.params.name === instance)

const recordVerdict =
  (run: TRun, findRow: TTaskRowLookup, moment: string) =>
  (outcome: TTasksOutcome, instance: string): readonly string[] => {
    if (
      !outcome.results.some(
        (result) => (result.selected[instance]?.length ?? 0) > 0,
      )
    )
      return []
    const report = changeReport(outcome, instance)
    if (report === undefined) return []
    const violations = violationsOf(report)
    const row = findRow(instance)
    const name = `tasks:${moment}`
    if (row !== undefined) run.tracer.gateRow(row, name, report)
    run.tracer.event({
      run_id: run.runId,
      activity_run_id: row?.activity_run_id ?? '',
      type: violations.length > 0 ? 'gate_fail' : 'gate_pass',
      name,
      payload: { violations, checks: report.checks },
    })
    run.console.gateResult(name, report)
    return violations
  }

export const chainMoments = (run: TRun): TMoments => {
  const evaluate = (
    moment: TTaskMoment,
    contributions: readonly TTaskContribution[],
  ) =>
    runTasks(liveTaskPorts)({
      cfg: run.cfg,
      root: run.vcsRoot,
      baseRef: runStartIn(run)?.head ?? '',
      contributions,
      moment,
      artifactFor: evaluationArtifact(run.contextHandoffDir),
      ...recordTaskCommands(run, {
        findRow: moment.kind === 'after' ? rowFor(run) : persistedRowFor(run),
        ...(moment.kind === 'change' ? {} : { moment: moment.kind }),
      }),
    })
  const wholeRun = async (
    moment: TTaskMoment & Readonly<{ kind: 'deliver' | 'before' }>,
  ): Promise<TMomentVerdict> => {
    const writer = lastWriter(run)
    if (writer === undefined) return { kind: 'pass' }
    const outcome = await evaluate(moment, [
      { ...writer, paths: runChangedPaths(run) },
    ])
    if (moment.kind === 'deliver') {
      for (const skipped of outcome.skipped) {
        run.tracer.event({
          run_id: run.runId,
          activity_run_id:
            persistedRowFor(run)(writer.instance)?.activity_run_id ?? '',
          type: 'log',
          name: 'task_skipped',
          payload: { ...skipped, moment: 'deliver' },
        })
        run.console.note(
          `task ${skipped.task}: skipped because ${skipped.activity} changed files last`,
        )
      }
    }
    const violations = recordVerdict(
      run,
      persistedRowFor(run),
      moment.kind,
    )(outcome, writer.instance)
    return violations.length === 0
      ? { kind: 'pass' }
      : {
          kind: 'fail',
          moment: moment.kind,
          writer,
          violations,
          tasks: outcome.results
            .filter((result) => !result.passed)
            .map((result) => result.name),
        }
  }
  return {
    before: (stage) =>
      wholeRun({
        kind: 'before',
        stage: stage.map((activity) => activity.name),
      }),
    deliver: () => wholeRun({ kind: 'deliver' }),
    after: async (stage, excluded = []) => {
      const outcome = await evaluate(
        { kind: 'after', stage: stage.map((activity) => activity.name) },
        stage.map((activity) => ({
          instance: activity.instance,
          activity:
            activity.params.kind === 'agent'
              ? activity.params.owner
              : activity.name,
          paths: excluded.includes(activity.instance)
            ? []
            : touchedBy(run, activity.instance).map((path) =>
                relative(run.vcsRoot, resolve(run.repoRoot, path)),
              ),
        })),
      )
      return new Map(
        stage.map((activity) => [
          activity.instance,
          {
            violations: recordVerdict(
              run,
              rowFor(run),
              'after',
            )(outcome, activity.instance),
          },
        ]),
      )
    },
  }
}
