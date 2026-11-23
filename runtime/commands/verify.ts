#!/usr/bin/env bun

/** Evaluate change tasks without starting a run, agent or trace. */

import { basename, join, relative, resolve } from 'node:path'
import { errorMessage, settleAsync } from '../../lib/typedefs'
import { loadConfig } from '../domains/config'
import {
  liveTaskPorts,
  NO_TASKS_DECLARED,
  runChangeTasks,
  taskArtifactName,
  taskResultNote,
} from '../domains/tasks'
import {
  diffFiles,
  filesUnder,
  headAt,
  repoRoot,
  requireSelected,
  resolveBaseBranch,
  resolveDataPaths,
  rev,
  selectRange,
  snapshotTree,
  untrackedFiles,
  vcsRoot,
} from '../domains/workspace'
import type { TPiCrustConfig } from '../lib/contracts'
import { DEFAULT_CONFIG_PATH, EXIT, isRange } from '../lib/contracts'
import { configPathFromEnv, ensureDir } from '../lib/system'
import { paint, writeLine } from '../lib/terminal'

const flagValue = (
  argv: readonly string[],
  flag: string,
): string | undefined => {
  const at = argv.indexOf(flag)
  return at === -1 ? undefined : argv[at + 1]
}

const workingChange = (
  cfg: Readonly<Pick<TPiCrustConfig, 'terminal'>>,
  scope: string,
) => {
  const workspaceRoot = repoRoot()
  const root = vcsRoot(workspaceRoot)
  const fromRoot = (source: string) => (path: string) =>
    relative(root, resolve(source, path))
  const fromWorkspace = fromRoot(workspaceRoot)
  const fromVcs = fromRoot(root)
  const fromCwd = fromRoot(process.cwd())
  const head = headAt(root)
  if (scope === '') {
    const paths = Object.keys(
      snapshotTree({ workspaceRoot, vcsRoot: root }),
    ).map(fromWorkspace)
    return {
      workspaceRoot,
      root,
      baseRef: head,
      paths: head === '' ? [...paths, ...filesUnder(':/').map(fromCwd)] : paths,
    }
  }
  const selection = selectRange(resolveBaseBranch(cfg, ''))(scope)
  const selected = requireSelected(selection)
  const paths = isRange(scope)
    ? selected.map(fromVcs)
    : selection.from === ''
      ? selected.map(fromCwd)
      : [
          ...diffFiles(selection.from).map(fromVcs),
          ...untrackedFiles().map(fromWorkspace),
        ]
  return {
    workspaceRoot,
    root,
    paths,
    baseRef: selection.from === '' ? head : rev(`${selection.from}^{commit}`),
  }
}

export const main = async (argv: readonly string[]): Promise<number> => {
  const configPath =
    flagValue(argv, '--config') ?? configPathFromEnv() ?? DEFAULT_CONFIG_PATH
  const scope = flagValue(argv, '--scope') ?? flagValue(argv, '--base') ?? ''
  const settled = await settleAsync(async () => {
    const cfg = loadConfig(configPath)
    const { workspaceRoot, root, baseRef, paths } = workingChange(cfg, scope)
    const { dataDir } = resolveDataPaths(cfg, workspaceRoot)
    const instance = 'working tree'
    const outcome = await runChangeTasks(liveTaskPorts)({
      cfg,
      root,
      baseRef,
      contributions: [{ instance, activity: undefined, paths }],
      artifactFor: (task) =>
        join(
          ensureDir(join(dataDir, 'checks', basename(workspaceRoot))),
          taskArtifactName(task),
        ),
      onCommandStart: ({ task, command }) =>
        writeLine(paint(`task ${task}: ${command}`, 'dim')),
      onCommandEnd: ({ task, result }) =>
        writeLine(
          paint(
            `task ${task}: ${result.passed ? 'passed' : 'failed'} (exit ${result.returncode}, ${result.durationSeconds.toFixed(3)}s)`,
            'dim',
          ),
        ),
    })
    if (outcome.declared === 0) writeLine(paint(NO_TASKS_DECLARED, 'yellow'))
    if (outcome.existing[instance] === 0)
      writeLine(paint('nothing changed — no tasks apply', 'dim'))
    const failed = outcome.results.filter(({ passed }) => !passed)
    for (const task of failed)
      writeLine(paint(`task ${task.name}: ${taskResultNote(task)}`, 'red'))
    if (outcome.results.length > 0) {
      writeLine(
        failed.length === 0
          ? paint(`all ${outcome.results.length} task(s) passed`, 'green')
          : paint(
              `${failed.length} of ${outcome.results.length} task(s) failed`,
              'red',
            ),
      )
    }
    const unmatched = outcome.unmatched[instance]?.length ?? 0
    if (unmatched > 0)
      writeLine(
        paint(`${unmatched} path(s) changed that no task matched`, 'yellow'),
      )
    return failed.length === 0 ? EXIT.SUCCESS : EXIT.FAILED
  })
  if (settled.status === 'error') {
    process.stderr.write(`${errorMessage(settled.error)}\n`)
    return EXIT.FAILED
  }
  return settled.data
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)))
