import { pushDefaultRemote, remoteNames } from '../data/git'

export type TDeliveryRemoteCandidates = Readonly<{
  configured: string | undefined
  pushDefault: string
  remotes: readonly string[]
}>
export const deliveryRemoteFrom = ({
  configured,
  pushDefault,
  remotes,
}: TDeliveryRemoteCandidates): string =>
  configured ??
  (pushDefault || (remotes.length === 1 ? (remotes[0] ?? 'origin') : 'origin'))

export const resolveDeliveryRemote = (
  configured: string | undefined,
  cwd?: string,
): string =>
  deliveryRemoteFrom({
    configured,
    pushDefault: pushDefaultRemote(cwd),
    remotes: remoteNames(cwd),
  })
