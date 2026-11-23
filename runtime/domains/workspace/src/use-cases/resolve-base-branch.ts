import type { TBaseBranch, TPiCrustConfig } from '../../../../lib/contracts'
import { BUILT_IN_BASE_BRANCH } from '../../../../lib/contracts'
import { remoteDefaultBranch } from '../data/git'
import { resolveDeliveryRemote } from './resolve-delivery-remote'

export type TBaseBranchCandidates = Readonly<{
  flag: string
  configured: string | undefined
  remoteDefault: string
  remote: string
}>

export const baseBranchFrom = (
  candidates: TBaseBranchCandidates,
): TBaseBranch => {
  const { flag, configured, remoteDefault, remote } = candidates
  if (flag) return { name: flag, source: 'flag', remote }
  if (configured) return { name: configured, source: 'configuration', remote }
  if (remoteDefault)
    return { name: remoteDefault, source: 'remote-default', remote }
  return { name: BUILT_IN_BASE_BRANCH, source: 'built-in', remote }
}

export const baseBranchProvenance = (base: TBaseBranch): string => {
  switch (base.source) {
    case 'flag':
      return 'named by the --scope flag'
    case 'configuration':
      return 'named by delivery.base in configuration'
    case 'remote-default':
      return `the default branch remote '${base.remote}' declares`
    case 'built-in':
      return `the built-in fallback: nothing named a base branch and remote '${base.remote}' declares no default`
  }
}

export const configuredBase = (
  cfg: Readonly<Pick<TPiCrustConfig, 'terminal'>>,
): Readonly<{ configured: string | undefined; remote: string | undefined }> => {
  const entry = cfg.terminal.find((one) => one.name === 'gh-pull-request')
  return {
    configured: entry?.delivery.base,
    remote: entry?.delivery.remote,
  }
}

export type TBaseBranchGit = Readonly<{
  remoteDefaultBranch: (remote: string) => string
  deliveryRemote: (configured: string | undefined) => string
}>

export const resolveBaseBranchWith =
  (git: TBaseBranchGit) =>
  (
    cfg: Readonly<Pick<TPiCrustConfig, 'terminal'>>,
    flag: string,
  ): TBaseBranch => {
    const base = configuredBase(cfg)
    const configured = base.configured
    const remote = git.deliveryRemote(base.remote)
    return baseBranchFrom({
      flag,
      configured,
      remoteDefault: git.remoteDefaultBranch(remote),
      remote,
    })
  }

export const resolveBaseBranch = resolveBaseBranchWith({
  remoteDefaultBranch,
  deliveryRemote: resolveDeliveryRemote,
})
