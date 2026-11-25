/** Process, filesystem, clock and id primitives with no domain knowledge */

export { monotonicMs, nowIso } from './src/clock'
export type { TEnv } from './src/env-overrides'
export {
  configPathFromEnv,
  dataDirFromEnv,
  dbPathFromEnv,
  machineConfigDirFromEnv,
  packageConfigDirFromEnv,
} from './src/env-overrides'
export {
  appendText,
  ensureDir,
  ensureParentDir,
  fileExists,
  humanSize,
  isFile,
  readText,
  writeText,
} from './src/files'
export { newId } from './src/ids'
export { operatorEnv } from './src/operator-env'
export {
  findPackageRoot,
  ownProgram,
  PACKAGE_ROOT,
  PROGRAM_EXTENSION,
  packageProgram,
  programName,
  RUNTIME_NAME,
  RUNTIME_PATH,
} from './src/own-package'
export { whichOnPath } from './src/which-on-path'
