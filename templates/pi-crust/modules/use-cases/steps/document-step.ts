/**
 * document: write up the change, measured from the run's own baseline.
 *
 * The diff is captured inside the phase body, against `ctx.baseline` — the
 * commit this run started from, not `main`, because a chain that commits as it
 * goes has already moved `main` by the time it documents. An empty change-set
 * throws before the documenter is spawned: there is nothing to document until
 * something was built, and a phase saying so costs nothing where an agent
 * discovering it costs a context window.
 */

import {
  baseRefLabel,
  changeCapture,
  changeSetEmpty,
} from '../../typedefs/changes'
import { documentOutput } from '../../typedefs/envelope'
import { phaseParams } from '../../typedefs/phase'
import type { TStep, TStepOptions } from '../../typedefs/step'
import { stepPhaseName } from '../../typedefs/step'
import { captureChanges, changesAsEnvelope } from '../capture-changes'
import { callAgent } from '../execute-agent'
import { artifactsExist, filesNonEmpty } from '../gates'
import { readEnvelope } from '../read-envelope'

export const DOCUMENT_NOTES =
  'Read diff_path in full before writing. Document only what the diff shows, ' +
  'then copy the write-up into app_docs/ as your task describes.'

export const documentStep = (options: TStepOptions): TStep => {
  const phaseName = stepPhaseName('document', options.instance)
  return {
    name: 'document',
    params: phaseParams({
      name: phaseName,
      kind: 'agent',
      owner: 'documenter',
      retries: 1,
      description:
        'Turn the captured diff into a write-up an engineer can read',
    }),
    requires: ['documenter'],

    execute: async (ctx, handle) => {
      const base = ctx.baseline || options.base || 'main'
      const captured = captureChanges(ctx.run, changeCapture({ base }))
      handle.log({
        base: `${baseRefLabel(captured.base)} @ ${captured.base.commit.slice(0, 7)}`,
        reason: captured.base.reason,
        files: captured.files.length + captured.untracked.length,
        lines: `+${captured.insertions} -${captured.deletions}`,
        diff: captured.diffPath,
      })
      if (changeSetEmpty(captured)) {
        throw new Error(
          `nothing changed since ${baseRefLabel(captured.base)} ` +
            `(${captured.base.reason}) — documenting runs after a build.`,
        )
      }
      const envelope = await callAgent(ctx.run, handle, {
        outputType: documentOutput,
        prompt: ctx.prompt,
        previous: changesAsEnvelope(captured, DOCUMENT_NOTES),
        gates: [artifactsExist, filesNonEmpty],
        changedPaths: [...captured.files, ...captured.untracked],
      })
      return { previous: envelope, accepted: envelope.status === 'success' }
    },

    replay: (ctx) => {
      const settled = readEnvelope(ctx.run, 'documenter', documentOutput)
      if (settled.status === 'error') {
        throw new Error(
          `cannot resume phase '${phaseName}': ${settled.error.message}. ` +
            'Drop --resume so it runs again.',
        )
      }
      return Promise.resolve({
        previous: settled.data,
        accepted: settled.data.status === 'success',
      })
    },
  }
}
