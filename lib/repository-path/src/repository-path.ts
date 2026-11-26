import { createHash } from 'node:crypto'
import { basename } from 'node:path'

export const LOCAL_DIRNAME = 'local'
export type TRepositoryIdentity = Readonly<{
  originUrl: string | undefined
  primaryClone: string
}>

export const repositoryPathFromRemote = (
  url: string,
): readonly string[] | undefined => {
  const trimmed = url.trim()
  const scheme = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.exec(trimmed)?.[0]
  const colon = trimmed.indexOf(':')
  const slash = trimmed.indexOf('/')
  const path =
    scheme === undefined
      ? colon >= 0 && (slash < 0 || colon < slash)
        ? trimmed.slice(colon + 1)
        : undefined
      : scheme.toLowerCase() === 'file://'
        ? undefined
        : trimmed.slice(scheme.length).split('/').slice(1).join('/')
  if (path === undefined) return undefined
  const segments = path
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.git$/, '')
    .split('/')
  return segments.length >= 2 &&
    segments.every(
      (segment) =>
        segment !== '' &&
        segment !== '.' &&
        segment !== '..' &&
        !/[\\\0]/.test(segment),
    )
    ? segments
    : undefined
}

export const repositoryPathOf = (
  identity: TRepositoryIdentity,
): readonly string[] =>
  (identity.originUrl === undefined
    ? undefined
    : repositoryPathFromRemote(identity.originUrl)) ?? [
    LOCAL_DIRNAME,
    `${basename(identity.primaryClone)}-${createHash('sha256').update(identity.primaryClone, 'utf8').digest('hex').slice(0, 8)}`,
  ]
