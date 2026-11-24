import type { Session } from '../typedefs/session'

export const lastPathSegment = (path: string): string =>
  path.split('/').filter(Boolean).at(-1) ?? path
export const resolveRepositoryLabel = ({
  repository,
}: Readonly<Pick<Session, 'repository'>>): string => repository || 'unknown'
