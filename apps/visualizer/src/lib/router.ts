/**
 * Hash routing, small enough to own.
 *
 * `#/` is the session list, `#/<run_id>` a waterfall, `#/<run_id>/<phase_id>`
 * a phase panel. A router library would be more code than this and would make
 * the skill less portable, which is the only axis this app competes on.
 *
 * The store is framework-free and React subscribes via `useSyncExternalStore`,
 * so the parsing is testable without a renderer.
 */

export type TRoute = Readonly<{
  runId: string | undefined
  phaseId: string | undefined
  /**
   * Which working tree the run is in, when the link says.
   *
   * Absent is a complete address on its own: the server finds the run across
   * every tree it watches. Carrying it makes the link exact, which matters
   * because run ids are minted per tree and two trees could mint the same
   * one.
   */
  workspace: string | undefined
}>

/**
 * `#/<run>`, or `#/<workspace>:<run>` — one segment either way.
 *
 * A colon rather than another slash, so a link written before workspaces
 * existed still parses as the run it always meant, and so a phase id stays
 * the second segment rather than sliding depending on what precedes it.
 */
const splitRun = (
  segment: string | undefined,
): Readonly<{ runId: string | undefined; workspace: string | undefined }> => {
  if (segment === undefined) return { runId: undefined, workspace: undefined }
  const colon = segment.indexOf(':')
  return colon === -1
    ? { runId: segment, workspace: undefined }
    : {
        workspace: segment.slice(0, colon),
        runId: segment.slice(colon + 1),
      }
}

export const parseHash = (hash: string): TRoute => {
  const parts = hash
    .replace(/^#\/?/, '')
    .split('/')
    .filter(Boolean)
    .map(decodeURIComponent)
  const { runId, workspace } = splitRun(parts[0])
  return { runId, phaseId: parts[1], workspace }
}

export const hrefFor = (
  runId?: string,
  phaseId?: string,
  workspace?: string,
): string => {
  if (runId === undefined) return '#/'
  const run =
    workspace === undefined || workspace === ''
      ? encodeURIComponent(runId)
      : `${encodeURIComponent(workspace)}:${encodeURIComponent(runId)}`
  return phaseId === undefined
    ? `#/${run}`
    : `#/${run}/${encodeURIComponent(phaseId)}`
}

export const navigate = (
  runId?: string,
  phaseId?: string,
  workspace?: string,
): void => {
  window.location.hash = hrefFor(runId, phaseId, workspace)
}

/**
 * One cached snapshot per hash.
 *
 * `useSyncExternalStore` compares snapshots by identity and re-renders when
 * they differ, so parsing afresh on every read would loop forever. The cache
 * is the contract, not an optimisation.
 */
let snapshot: TRoute = {
  runId: undefined,
  phaseId: undefined,
  workspace: undefined,
}
let snapshotFor = '\u0000'

export const routeSnapshot = (): TRoute => {
  const hash = window.location.hash
  if (hash !== snapshotFor) {
    snapshotFor = hash
    snapshot = parseHash(hash)
  }
  return snapshot
}

export const subscribeToRoute = (onChange: () => void): (() => void) => {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}
