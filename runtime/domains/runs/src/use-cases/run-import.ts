import {
  activityRunParams,
  IMPORT_NAME,
  importOutput,
  type TImportOutput,
  type TRun,
} from '../../../../lib/contracts'
import { fileExists, writeText } from '../../../../lib/system'
import { envelopeHistoryPath, readHistoryEnvelope } from '../../../activities'
import { importWork, liveImport, type TImportPorts } from '../../../imports'
import { skipIfDone } from './resume'

export const IMPORT_RUN_PARAMS = activityRunParams({
  name: IMPORT_NAME,
  kind: 'code',
  owner: 'pi-crust',
  description:
    'Bring the work the request references into the handoff directory before any Activity runs',
})

export const runImport =
  (ports: TImportPorts = liveImport) =>
  (
    params: Readonly<{
      run: TRun
      request: string
      promptPath: string | undefined
      chain: readonly string[]
    }>,
  ): Promise<TImportOutput | undefined> => {
    const { run } = params
    return skipIfDone(
      run,
      IMPORT_RUN_PARAMS,
      (handle) => {
        const result = importWork(ports)({
          request: params.request,
          promptPath: params.promptPath,
          chain: params.chain,
          cwd: process.cwd(),
          repoRoot: run.repoRoot,
          handoffDir: run.contextHandoffDir,
          activities: run.cfg.activities,
          protectedFiles: run.cfg.defaults.protected_files,
        })
        if (result.status === 'error') throw result.error
        const envelope =
          result.data === undefined
            ? undefined
            : importOutput.schema.parse(result.data)
        if (envelope === undefined) {
          handle.log({
            imported: 0,
            because:
              'the request references nothing and the handoff directory holds no work document',
          })
          return undefined
        }
        handle.log({
          source: envelope.source.kind,
          reference: envelope.source.written,
          imported: envelope.documents.filter(
            (document) => document.status === 'imported',
          ).length,
          present: envelope.documents.filter(
            (document) => document.status === 'present',
          ).length,
          comments: envelope.comments.length,
          unattributed: envelope.unattributed.length,
        })
        run.tracer.envelopeRow(
          handle.activityRun,
          IMPORT_NAME,
          importOutput.name,
          JSON.stringify(envelope, undefined, 2),
          true,
        )
        writeText(
          envelopeHistoryPath(run, IMPORT_NAME),
          `${JSON.stringify({ output_type: importOutput.name, ...envelope }, undefined, 2)}\n`,
        )
        return envelope
      },
      () =>
        Promise.resolve().then(() => {
          if (!fileExists(envelopeHistoryPath(run, IMPORT_NAME)))
            return undefined
          const result = readHistoryEnvelope(
            run,
            IMPORT_NAME,
            IMPORT_NAME,
            importOutput,
          )
          if (result.status === 'error') throw result.error
          return result.data
        }),
    )
  }
