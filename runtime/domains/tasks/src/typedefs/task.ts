import type { TPiCrustConfig } from '../../../../lib/contracts'

export type TTaskContribution = Readonly<{
  instance: string
  activity: string | undefined
  paths: readonly string[]
}>

export type TTaskCommandResult = Readonly<{
  command: string
  returncode: number
  passed: boolean
  timedOut: boolean
  timeoutSeconds: number
  durationSeconds: number
  outputTail: string
}>

export type TTaskResult = Readonly<{
  name: string
  selected: Readonly<Record<string, readonly string[]>>
  commands: readonly TTaskCommandResult[]
  passed: boolean
  outputArtifact: string
}>

export type TChangeOutcome = Readonly<{
  declared: number
  results: readonly TTaskResult[]
  existing: Readonly<Record<string, number>>
  unmatched: Readonly<Record<string, readonly string[]>>
}>

export type TTaskCommandEvent = Readonly<{
  task: string
  result: TTaskCommandResult
  outputArtifact: string
  instances: readonly string[]
  startedAt: string
  endedAt: string
}>

export type TTaskCommandStart = Readonly<{
  task: string
  command: string
  instances: readonly string[]
}>

export type TShellSpec = Readonly<{
  command: string
  cwd: string
  timeoutSeconds: number
  env: Readonly<Record<string, string>>
}>

export type TShellResult = Readonly<{
  returncode: number
  timedOut: boolean
  stdout: string
  stderr: string
  durationSeconds: number
}>

export type TTaskPorts = Readonly<{
  exists: (absolutePath: string) => boolean
  runShell: (spec: TShellSpec) => Promise<TShellResult>
  writeArtifact: (path: string, text: string) => void
}>

export type TChangeTasksParams = Readonly<{
  cfg: Readonly<Pick<TPiCrustConfig, 'tasks' | 'task_config' | 'activities'>>
  root: string
  baseRef: string
  contributions: readonly TTaskContribution[]
  artifactFor: (task: Readonly<{ name: string; index: number }>) => string
  onCommandStart: (starting: TTaskCommandStart) => void
  onCommandEnd: (ran: TTaskCommandEvent) => void
}>
