/**
 * The shape every agent step shares: call the agent, or read back what it said.
 *
 * Replay reads `{sessionDir}/{agent}/envelope.json`, which exists because
 * `executeAgent` persists an envelope the moment it parses — before gates rule
 * on it. A missing one is reported with the exact path and both ways forward,
 * never papered over with `previous: undefined`: that silence is the bug this
 * whole mechanism was built to close.
 */

import type { TEnvelopeBase, TEnvelopeSpec } from '../../typedefs/envelope'
import type { TGate } from '../../typedefs/gate'
import { phaseParams } from '../../typedefs/phase'
import type { TStep, TStepContext, TStepName } from '../../typedefs/step'
import { stepPhaseName } from '../../typedefs/step'
import { callAgent } from '../execute-agent'
import { intakeRejection, intakeViolations } from '../intake'
import { readEnvelope } from '../read-envelope'

export type TAgentStepParams<TEnvelope extends TEnvelopeBase> = Readonly<{
  name: TStepName
  owner: string
  description: string
  spec: TEnvelopeSpec<TEnvelope>
  gates: readonly TGate[]
  retries: number
  instance: number
  /** this step's own criterion — `approved` for a review, status otherwise */
  accepted: (envelope: TEnvelope) => boolean
  /** paths the call is about, for routing.skills; omitted = the working tree */
  changedPathsOf?: (ctx: TStepContext) => readonly string[] | undefined
  /** the ref or range this call judges; '' is whatever the chain changed */
  changeBase?: string
}>

export const agentStep = <TEnvelope extends TEnvelopeBase>(
  params: TAgentStepParams<TEnvelope>,
): TStep => {
  const phaseName = stepPhaseName(params.name, params.instance)
  return {
    name: params.name,
    params: phaseParams({
      name: phaseName,
      kind: 'agent',
      owner: params.owner,
      description: params.description,
      retries: params.retries,
    }),
    requires: [params.owner],

    execute: async (ctx, handle) => {
      // Intake first, and before the spawn: a context that was never usable
      // must not cost an agent call to discover. The judgement half of intake
      // is the agent's own, in its `## Intake` instruction.
      const violations = intakeViolations(ctx.previous, ctx.previousStep ?? '')
      if (violations.length > 0) {
        throw new Error(intakeRejection(violations, phaseName))
      }
      const changedPaths = params.changedPathsOf?.(ctx)
      const envelope = await callAgent(ctx.run, handle, {
        outputType: params.spec,
        prompt: ctx.prompt,
        ...(ctx.previous === undefined ? {} : { previous: ctx.previous }),
        gates: params.gates,
        ...(changedPaths === undefined ? {} : { changedPaths }),
        ...(params.changeBase === undefined || params.changeBase === ''
          ? {}
          : { changeBase: params.changeBase }),
      })
      return { previous: envelope, accepted: params.accepted(envelope) }
    },

    replay: (ctx) => {
      const settled = readEnvelope(ctx.run, params.owner, params.spec)
      if (settled.status === 'error') {
        throw new Error(
          `cannot resume phase '${phaseName}': ${settled.error.message}. ` +
            'Either drop --resume so it runs again, or run that step on its ' +
            `own: bun .pi-crust/stages/${params.name}.ts --run-id ` +
            `${ctx.run.runId} "<the original request>"`,
        )
      }
      return Promise.resolve({
        previous: settled.data,
        accepted: params.accepted(settled.data),
      })
    },
  }
}
