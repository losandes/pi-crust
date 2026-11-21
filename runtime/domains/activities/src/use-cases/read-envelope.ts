/**
 * Read an agent's last envelope back off disk — the replay path for resume.
 *
 * `executeAgent` writes `{sessionDir}/{agent}/envelope.json` the moment a
 * response parses, so an activity run that already succeeded in this session can be
 * replayed without re-spawning the agent. Metadata keys are added by the
 * writer and are not part of the contract, so they come off before the schema
 * sees the object. Run history also keeps a snapshot per participant, so an
 * engine-named reviser cannot overwrite its writer's earlier envelope.
 */

import { join } from 'node:path'
import type { TSettlement } from '../../../../../lib/typedefs'
import { fail, safeParseSettlement } from '../../../../../lib/typedefs'
import type {
  TEnvelopeBase,
  TEnvelopeSpec,
  TRun,
} from '../../../../lib/contracts'
import { fileExists, readText } from '../../../../lib/system'
/** Keys `persistEnvelope` adds for a human reader; never part of the schema. */
export const ENVELOPE_METADATA_KEYS = [
  'agent_name',
  'purpose',
  'output_type',
] as const

export const envelopePath = (
  run: Readonly<Pick<TRun, 'sessionDir'>>,
  agentName: string,
): string => join(run.sessionDir, agentName, 'envelope.json')

export const envelopeHistoryPath = (
  run: Readonly<Pick<TRun, 'sessionDir'>>,
  activity: string,
): string => join(run.sessionDir, 'envelope-history', activity, 'envelope.json')

const readEnvelopeAt =
  <TEnvelope extends TEnvelopeBase>(spec: TEnvelopeSpec<TEnvelope>) =>
  (agentName: string, path: string): TSettlement<TEnvelope> => {
    if (!fileExists(path)) {
      return fail(new Error(`no envelope on disk for '${agentName}': ${path}`))
    }
    return safeParseSettlement(() => {
      const raw = JSON.parse(readText(path)) as Record<string, unknown>
      const payload = Object.fromEntries(
        Object.entries(raw).filter(
          ([key]) =>
            !(ENVELOPE_METADATA_KEYS as readonly string[]).includes(key),
        ),
      )
      return spec.schema.parse(payload)
    })
  }

export const readEnvelope = <TEnvelope extends TEnvelopeBase>(
  run: Readonly<Pick<TRun, 'sessionDir'>>,
  agentName: string,
  spec: TEnvelopeSpec<TEnvelope>,
): TSettlement<TEnvelope> =>
  readEnvelopeAt(spec)(agentName, envelopePath(run, agentName))

/** Old sessions have only the per-agent file; preserve their replay path. */
export const readHistoryEnvelope = <TEnvelope extends TEnvelopeBase>(
  run: Readonly<Pick<TRun, 'sessionDir'>>,
  activity: string,
  agentName: string,
  spec: TEnvelopeSpec<TEnvelope>,
): TSettlement<TEnvelope> => {
  const path = envelopeHistoryPath(run, activity)

  return readEnvelopeAt(spec)(
    agentName,
    fileExists(path) ? path : envelopePath(run, agentName),
  )
}
