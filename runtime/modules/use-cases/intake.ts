/**
 * Intake: can this stage proceed on what the last one handed it?
 *
 * The lifecycle (`adr/context/sdlc.md`) makes the receiving stage the gate. It
 * must evaluate whether the previous stage achieved its objective, and reject
 * rather than proceed when continuing would require inventing material facts.
 *
 * Two halves, and only one of them is here.
 *
 * The STRUCTURAL half is deterministic and runs in code, before the agent is
 * spawned — so a context that was never going to be usable costs nothing to
 * refuse. A decision without a rationale is a decision the next stage will
 * re-make; an assumption with nothing that would disprove it is decoration
 * rather than a regression trigger; a `met: true` with no evidence is the
 * self-assessment this whole design exists to distrust.
 *
 * The JUDGEMENT half belongs to the receiving agent, as its first act inside
 * its own activityRun, and lives in the prompts. It is not here and must not be: the
 * question "could I proceed without inventing something" is only honestly
 * answerable by whoever must proceed, and a third party asked to simulate it
 * has no stake in the answer. See the `## Intake` section of each user.md.
 *
 * Pure: it inspects an envelope and returns what is wrong with it.
 */

import type { TEnvelopeBase } from '../typedefs/envelope'
import { contextEnvelopeSchema } from '../typedefs/envelope'

/** Text that says an agent left the template in place. */
const PLACEHOLDER = /\b(TODO|TBD|FIXME|PLACEHOLDER|<[a-z_ ]+>)\b/i

const blank = (text: string): boolean => text.trim() === ''

/**
 * What is structurally wrong with an incoming context, in a reader's words.
 *
 * Empty means "nothing a tool can see", never "this context is good" — that
 * ruling is the agent's.
 */
export const intakeViolations = (
  envelope: TEnvelopeBase | undefined,
  producedBy: string,
): readonly string[] => {
  if (envelope === undefined) {
    return []
  }
  const parsed = contextEnvelopeSchema.safeParse(envelope)
  if (!parsed.success) {
    // Not a context envelope at all — `prompt` and the code activityRuns produce
    // these, and a stage receiving one has nothing structural to check.
    return []
  }
  const context = parsed.data
  const where = `'${producedBy}'`

  return [
    ...context.facts
      .filter((fact) => blank(fact.evidence))
      .map(
        (fact) =>
          `${where} states a fact with no evidence: "${fact.fact}". A fact ` +
          'without evidence is an assumption wearing the wrong label.',
      ),
    ...context.decisions
      .filter((decision) => blank(decision.rationale))
      .map(
        (decision) =>
          `${where} records a decision with no rationale: ` +
          `"${decision.decision}". This stage would have to re-decide it.`,
      ),
    ...context.assumptions
      .filter((assumption) => blank(assumption.invalidated_by))
      .map(
        (assumption) =>
          `${where} carries an assumption nothing would disprove: ` +
          `"${assumption.assumption}". An assumption with no invalidation ` +
          'trigger cannot cause a regression, which is the only thing an ' +
          'assumption is for.',
      ),
    ...(context.objective_met.met && blank(context.objective_met.evidence)
      ? [
          `${where} claims it met its objective with no evidence. The claim ` +
            'is the thing this stage is entitled to doubt.',
        ]
      : []),
    ...(PLACEHOLDER.test(context.summary)
      ? [`${where} left placeholder text in its summary: "${context.summary}"`]
      : []),
  ]
}

/** One line an activity run can fail with, or '' when nothing structural is wrong. */
export const intakeRejection = (
  violations: readonly string[],
  receivingStep: string,
): string =>
  violations.length === 0
    ? ''
    : `'${receivingStep}' will not start on this context:\n` +
      violations.map((violation) => `  - ${violation}`).join('\n') +
      '\n\nFix the stage that produced it rather than working around it here.'
