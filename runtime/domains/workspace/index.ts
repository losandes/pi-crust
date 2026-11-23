/** Git, worktrees, roots, and the machine-local workspace registry */

export { ABSENT, snapshotContent } from './src/data/content-snapshot'
export { resolveDataPaths, resolveLookupPaths } from './src/data/data-paths'
export { engineerName } from './src/data/engineer'
export {
  changedFiles,
  commitPaths,
  commitsAhead,
  currentBranch,
  diffFiles,
  filesUnder,
  headAt,
  isRepo,
  matchesHead,
  pushBranch,
  remoteDefaultBranch,
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
export { historyPaths, snapshotTree } from './src/data/working-tree'
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
export type {
  TBaseBranchCandidates,
  TBaseBranchGit,
} from './src/use-cases/resolve-base-branch'
export {
  baseBranchFrom,
  baseBranchProvenance,
  configuredBase,
  resolveBaseBranch,
  resolveBaseBranchWith,
} from './src/use-cases/resolve-base-branch'
export {
  requireSelected,
  selectedPaths,
  selectRange,
} from './src/use-cases/select-range'
