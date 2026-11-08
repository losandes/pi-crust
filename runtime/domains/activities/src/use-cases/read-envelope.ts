/**
 * Read an agent's last envelope back off disk — the replay path for resume.
 *
 * `executeAgent` writes `{sessionDir}/{agent}/envelope.json` the moment a
 * response parses, so an activity run that already succeeded in this session can be
 * replayed without re-spawning the agent. Four metadata keys are added by the
 * writer and are not part of the contract, so they come off before the schema
 * sees the object.
 */

import { join } from 'node:path'
import type { TSettlement } from '../../../../../lib/typedefs/src/settlement'
import {
  fail,
  safeParseSettlement,
} from '../../../../../lib/typedefs/src/settlement'
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

export const envelopePath = (run: TRun, agentName: string): string =>
  join(run.sessionDir, agentName, 'envelope.json')

export const readEnvelope = <TEnvelope extends TEnvelopeBase>(
  run: TRun,
  agentName: string,
  spec: TEnvelopeSpec<TEnvelope>,
): TSettlement<TEnvelope> => {
  const path = envelopePath(run, agentName)
  if (!fileExists(path)) {
    return fail(new Error(`no envelope on disk for '${agentName}': ${path}`))
  }
  return safeParseSettlement(() => {
    const raw = JSON.parse(readText(path)) as Record<string, unknown>
    const payload = Object.fromEntries(
      Object.entries(raw).filter(
        ([key]) => !(ENVELOPE_METADATA_KEYS as readonly string[]).includes(key),
      ),
    )
    return spec.schema.parse(payload)
  })
}
