import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fail, succeed } from '../../../../../lib/typedefs'
import { crustConfigSchema } from '../../../../lib/contracts'
import { runWithTracer } from '../../../../testing/fake-activity'
import { shippedConfig } from '../../../../testing/shipped-layer'
import {
  restoreTerminal,
  silenceTerminal,
} from '../../../../testing/terminal-capture'
import { envelopeHistoryPath } from '../../../activities'
import type { TImportPorts } from '../../../imports'
import { runImport } from './run-import'

const activities = shippedConfig().activities
const memory = (): Readonly<{ ports: TImportPorts }> => ({
  ports: {
    repository: () => succeed('owner/repo'),
    issue: () =>
      succeed({
        address: 'issue',
        posted_at: 'created',
        updated_at: 'updated',
        body: '---\n> _Handoff: Plan_\n---\n\nThe plan\n',
        pull_request: false,
        comments: [],
      }),
    document: () => fail(new Error('not a document test')),
    exists: () => false,
    write: () => succeed(undefined),
    remove: () => succeed(undefined),
    now: () => 'read',
  },
})

const fixture = (resume = false) => {
  const dir = mkdtempSync(join(tmpdir(), 'crust-run-import-'))
  silenceTerminal()
  const cfg = crustConfigSchema.parse({
    defaults: { data_dir: dir },
    observability: { db: join(dir, 'crust.db') },
    activities,
  })
  const run = runWithTracer(dir, cfg, resume ? new Set(['import']) : undefined)
  return {
    dir,
    run,
    [Symbol.dispose]: () => {
      run.tracer.close()
      restoreTerminal()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

test(
  [
    'given a source with work',
    'when the engine imports it',
    'it should record a code run an envelope and its replay file',
  ].join(', '),
  async () => {
    // given
    using given = fixture()
    const ports = memory().ports
    // when
    const actual = await runImport(ports)({
      run: given.run,
      request: '#150',
      promptPath: undefined,
      chain: ['build'],
    })
    // then
    expect(actual?.documents[0]?.activity).toBe('plan')
    expect(given.run.tracer.activityRunsFor(given.run.runId)[0]).toMatchObject({
      status: 'success',
      params: { kind: 'code', owner: 'pi-crust', name: 'import' },
    })
    expect(
      JSON.parse(
        readFileSync(envelopeHistoryPath(given.run, 'import'), 'utf8'),
      ),
    ).toEqual({ output_type: 'ImportOutput', ...actual })
  },
)

test(
  [
    'given a failed source read',
    'when the engine imports it',
    'it should throw and leave a failed code run',
  ].join(', '),
  async () => {
    // given
    using given = fixture()
    const ports = { ...memory().ports, issue: () => fail(new Error('denied')) }
    // when, then
    await expect(
      runImport(ports)({
        run: given.run,
        request: '#150',
        promptPath: undefined,
        chain: ['build'],
      }),
    ).rejects.toThrow('cannot import #150: denied')
    expect(given.run.tracer.activityRunsFor(given.run.runId)[0]).toMatchObject({
      status: 'fail',
      error: 'cannot import #150: denied',
    })
  },
)

test(
  [
    'given no source and no earlier documents',
    'when importing',
    'it should record success without an envelope history file',
  ].join(', '),
  async () => {
    // given
    using given = fixture()
    const ports = memory().ports
    // when
    const actual = await runImport(ports)({
      run: given.run,
      request: 'build a feature',
      promptPath: undefined,
      chain: ['build'],
    })
    // then
    expect(actual).toBeUndefined()
    expect(given.run.tracer.activityRunsFor(given.run.runId)[0]?.status).toBe(
      'success',
    )
    expect(Bun.file(envelopeHistoryPath(given.run, 'import')).size).toBe(0)
  },
)

for (const mode of ['stored', 'absent', 'invalid'] as const) {
  test(
    [
      'given SC10 a successful import being resumed',
      `when its history is ${mode}`,
      'it should replay without calling any import port',
    ].join(', '),
    async () => {
      // given
      using given = fixture(true)
      const source = memory()
      const original =
        mode === 'absent'
          ? undefined
          : await runImport(source.ports)({
              run: { ...given.run, claimResume: () => false },
              request: '#150',
              promptPath: undefined,
              chain: ['build'],
            })
      if (mode === 'invalid')
        writeFileSync(envelopeHistoryPath(given.run, 'import'), 'invalid')
      const never = () => {
        throw new Error('port called during replay')
      }
      const ports = {
        repository: never,
        issue: never,
        document: never,
        exists: never,
        write: never,
        remove: never,
        now: never,
      }
      // when, then
      const actual = runImport(ports)({
        run: given.run,
        request: '#150',
        promptPath: undefined,
        chain: ['build'],
      })
      if (mode === 'invalid') await expect(actual).rejects.toThrow()
      else expect(await actual).toEqual(original)
    },
  )
}
