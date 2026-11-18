import type { Session } from '../typedefs/session'

/**
 * The text shown where a run's git branch goes. A run with no recorded branch
 * shows the name of the working tree it came from instead, so the position is
 * never empty and never names a branch the run did not record.
 */
export const resolveBranchLabel = ({
  branch,
  workspace,
}: Readonly<Pick<Session, 'branch' | 'workspace'>>): string => {
  const recorded = branch ?? ''
  return recorded.trim() === '' ? workspace : recorded
}
