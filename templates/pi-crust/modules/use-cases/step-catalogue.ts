/**
 * The step catalogue the operator plans from, generated rather than written.
 *
 * The operator has to know what steps exist, what each is for, and who
 * performs it. Writing that into its prompt would guarantee it is wrong: the
 * day somebody adds a step, the operator keeps planning yesterday's factory
 * and the mistake is invisible — a plan that omits a step nobody told it
 * about looks exactly like a plan that chose not to use it.
 *
 * So it is built at render time from the same registry the runner executes
 * and the same roster the run validates. A step that exists is listed; a step
 * that is listed exists.
 */

import type { TAgentConfig } from '../typedefs/config'
import { STEP_NAMES } from '../typedefs/step'
import type { TStepName } from '../typedefs/step'
import { DEFAULT_STEP_OPTIONS } from '../typedefs/step'
import { STEP_REGISTRY } from './steps'

/**
 * Steps the operator may not plan, and must not be shown as options.
 *
 * `operator` is excluded from its own catalogue rather than merely forbidden
 * in the gate. Offering it and then rejecting it wastes a retry teaching the
 * agent something the prompt could simply not have suggested.
 */
const UNPLANNABLE: readonly string[] = ['operator']

/** What one agent is for, as the roster states it. */
const purposeOf = (agents: readonly TAgentConfig[], owner: string): string =>
  agents.find((agent) => agent.name === owner)?.purpose ?? ''

/**
 * One line per step: the name a plan must use, what it does, who does it.
 *
 * The description comes from the step itself and the purpose from the roster,
 * so the two halves of "what is this" stay with their owners instead of being
 * restated in a prompt that nobody updates.
 */
export const stepCatalogue = (agents: readonly TAgentConfig[]): string =>
  STEP_NAMES.filter((name) => !UNPLANNABLE.includes(name))
    .map((name: TStepName) => {
      const step = STEP_REGISTRY[name](DEFAULT_STEP_OPTIONS)
      const purpose = purposeOf(agents, step.requires[0] ?? '')
      const who = step.requires.length === 0 ? 'code, no agent' : step.requires.join(', ')
      return purpose === ''
        ? `- \`${name}\` — ${step.params.description} (${who})`
        : `- \`${name}\` — ${step.params.description} (${who}: ${purpose})`
    })
    .join('\n')
