/**
 * Where to watch this run, when there is somewhere to watch it.
 *
 * A run prints a link only if the observability API actually answers. A line
 * that said "open the visualizer" whether or not one was running would be
 * noise on every run and a lie on most of them — and a developer who followed
 * it to a dead port would trust the next hint less.
 *
 * The probe deliberately proves only that the API is up. In the normal case
 * the API and the UI start together (`just crust observe`, `pnpm crust:dev`), so the
 * inference holds; someone running the server alone gets a link to a vite that
 * is not there, which is a cost worth one HTTP call rather than two.
 */

import { DEFAULT_BE_PORT, DEFAULT_FE_PORT } from '../typedefs/config'
import type { TEnv } from './env-overrides'

/*
 * Defined with the schema that reads them out of `crust.observe.yaml`, and
 * re-exported here because this is where callers have always found them.
 */
export { DEFAULT_BE_PORT, DEFAULT_FE_PORT }

/** How long a run is willing to wait to find out. Milliseconds. */
export const PROBE_TIMEOUT_MS = 300

const portFrom = (value: string | undefined, fallback: number): number => {
  const parsed = Number((value ?? '').trim())
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65_536
    ? parsed
    : fallback
}

/*
 * The variable wins over the configured port, which wins over the default.
 *
 * `crust.observe.yaml` is the team's answer and is reviewed; CRUST_BE_PORT is
 * one developer's clash with something else on their machine, which is a
 * worse thing to commit than to export.
 */
export const backendPort = (
  env: TEnv = process.env,
  configured: number = DEFAULT_BE_PORT,
): number => portFrom(env.CRUST_BE_PORT, configured)

export const frontendPort = (
  env: TEnv = process.env,
  configured: number = DEFAULT_FE_PORT,
): number => portFrom(env.CRUST_FE_PORT, configured)

/**
 * The deep link to one run, on the route the trace view already reads.
 *
 * Hash routing, so the UI resolves it client-side and no server route has to
 * exist for it.
 */
export const runLink = (
  runId: string,
  env: TEnv = process.env,
  configured: number = DEFAULT_FE_PORT,
): string =>
  `http://localhost:${frontendPort(env, configured)}/#/${encodeURIComponent(runId)}`

/**
 * Is the observability API answering?
 *
 * Any failure — refused, timed out, answering something that is not ours —
 * reads as "no". This runs at the start of every run, so it must never throw
 * and must never be slow enough to notice.
 */
/**
 * Only what this needs: a URL and some options in, a response out.
 *
 * Narrower than `typeof fetch` on purpose — the global carries `preconnect`
 * and overloads nothing here uses, and a test should not have to fake them to
 * stand in for one GET.
 */
export type TFetch = (
  url: string,
  init?: Readonly<{ signal?: AbortSignal }>,
) => Promise<Readonly<{ ok: boolean; json: () => Promise<unknown> }>>

export const visualizerIsUp = async (
  env: TEnv = process.env,
  fetcher: TFetch = fetch,
  configured: number = DEFAULT_BE_PORT,
): Promise<boolean> => {
  /*
   * Every failure is the same answer. Refused, timed out, answering something
   * that is not ours — all of them mean "there is nowhere to send you", and a
   * probe that runs at the start of every run must never be the thing that
   * fails one.
   */
  // biome-ignore lint/plugin: this layer owns the boundary
  try {
    const response = await fetcher(
      `http://localhost:${backendPort(env, configured)}/api/health`,
      { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) },
    )
    if (!response.ok) return false
    const body = (await response.json()) as Readonly<{ ok?: unknown }>
    return body.ok === true
  } catch (cause) {
    void cause
    return false
  }
}
