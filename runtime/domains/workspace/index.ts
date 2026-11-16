/** Git, worktrees, roots, and the machine-local workspace registry */

export { ABSENT, snapshotContent } from './src/data/content-snapshot'
export { resolveDataPaths } from './src/data/data-paths'
export { engineerName } from './src/data/engineer'
export {
  changedFiles,
  commitPaths,
  commitsAhead,
  currentBranch,
  isRepo,
  pushBranch,
  remoteExists,
  repoRoot,
  rev,
  shortSha,
  untrackedFiles,
  upstreamBase,
  vcsRoot,
} from './src/data/git'
export type { TRoots } from './src/data/roots'
export { resolveClaim } from './src/data/roots'
export type { TTreeSnapshot } from './src/data/working-tree'
export { snapshotTree } from './src/data/working-tree'
export {
  forgetWorkspaces,
  readRegistry,
  registerWorkspace,
  registryPath,
} from './src/data/workspace-registry'
export {
  captureChanges,
  changesAsEnvelope,
} from './src/use-cases/capture-changes'
export {
  requireSelected,
  selectedPaths,
  selectRange,
} from './src/use-cases/select-range'
