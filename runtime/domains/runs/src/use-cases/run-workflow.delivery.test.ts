import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  EXIT,
  type TPiCrustConfig,
  type TStage,
} from '../../../../lib/contracts'
import { SKIP_INTEGRATION } from '../../../../testing/integration'
import { readRunState } from '../../../trace'
import { gateFixture, portsFor, work } from './human-gate-fixture.test'
import { deliveryFixture, refuseBuildCommit } from './run-terminal-fixture.test'
import { runWorkflow } from './run-workflow'

const plan: readonly TStage[] = [
  { name: 'implement', strategy: 'serial', activities: ['build'] },
  { name: 'deliver', strategy: 'serial', activities: ['gh-pull-request'] },
]

const configWithDelivery = (dir: string, cfg: TPiCrustConfig): string => {
  const system = join(dir, 'delivery-system.md')
  const user = join(dir, 'delivery-user.md')
  writeFileSync(system, '# Delivery fixture system\n')
  writeFileSync(user, '# Delivery fixture user\n')
  const terminal = {
    name: 'gh-pull-request',
    model: 'fixture/delivery',
    purpose: 'Deliver the completed run',
    prompts: { system, user },
    writes: [],
  }
  const path = join(dir, 'delivery.config.yaml')
  writeFileSync(
    path,
    Bun.YAML.stringify({
      ...cfg,
      agents: [...cfg.agents, terminal],
      terminal: [terminal],
    }),
  )
  return path
}

const argsFor = (
  config: string,
  runId: string,
): Parameters<typeof runWorkflow>[0] => ({
  prompt: 'Implement issue #125',
  config,
  runId,
  base: undefined,
  resume: false,
  activities: undefined,
  lifecycle: undefined,
  models: undefined,
  approveAfter: undefined,
  commit: undefined,
  stream: false,
  trustLevel: undefined,
  handoff: undefined,
  name: undefined,
})

for (const resume of [false, true]) {
  test(
    [
      `given a committing terminal Activity with --commit false, resume=${resume}`,
      'when runWorkflow performs startup checks',
      'it should reject before a session row, an Activity Run, or an agent spawn exists',
    ].join(', '),
    async () => {
      // given
      using fixture = gateFixture()
      const { run, dir } = fixture
      const config = configWithDelivery(dir, run.cfg)
      const runId = 'aabb0125'
      const { ports, requests } = portsFor(() => work())
      const args = {
        ...argsFor(config, runId),
        commit: 'false' as const,
        resume,
      }

      // when, then
      await expect(
        runWorkflow(
          args,
          plan,
          ports,
          () => ({ provider: 'fixture', modelId: 'model' }),
          async () => false,
        ),
      ).rejects.toThrow(
        "terminal Activity 'gh-pull-request' delivers this run's commits, and --commit false means this run makes none — drop --commit false, or choose a lifecycle that does not end in 'gh-pull-request'",
      )
      using db = new Database(run.tracer.dbPath, { readonly: true })
      expect(
        db
          .query<{ run_id: string }, [string]>(
            'SELECT s.run_id FROM sessions AS s WHERE s.run_id = ?',
          )
          .all(runId),
      ).toEqual([])
      expect(run.tracer.activityRunsFor(runId)).toEqual([])
      expect(requests()).toEqual([])
    },
  )
}

test(
  [
    'given the same Lifecycle without --commit false',
    'when runWorkflow starts and reaches requested approval before delivery',
    'it should pass startup and execute build without calling a live terminal port',
  ].join(', '),
  async () => {
    // given
    using fixture = gateFixture()
    const { run, dir } = fixture
    const config = configWithDelivery(dir, run.cfg)
    const runId = 'ccdd0125'
    const { ports, requests } = portsFor(() => work())
    const signals = {
      SIGINT: process.listeners('SIGINT'),
      SIGTERM: process.listeners('SIGTERM'),
    }
    try {
      // when
      const actual = await runWorkflow(
        { ...argsFor(config, runId), approveAfter: 'build' },
        plan,
        ports,
        () => ({ provider: 'fixture', modelId: 'model' }),
        async () => false,
      )

      // then
      expect(actual).toBe(EXIT.WAITING)
      expect(readRunState(run.tracer.dbPath, runId)?.status).toBe('waiting')
      expect(requests()).toHaveLength(1)
      expect(
        run.tracer
          .activityRunsFor(runId)
          .some((row) => row.params.name === 'build'),
      ).toBe(true)
    } finally {
      for (const signal of ['SIGINT', 'SIGTERM'] as const) {
        for (const listener of process.listeners(signal)) {
          if (!signals[signal].includes(listener))
            process.removeListener(signal, listener)
        }
      }
    }
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given successful work replayed from a run whose commit is still refused',
    'when runWorkflow reaches its terminal Activity',
    'it should finish WAITING through the delivery outcome without invoking gh or an agent',
  ].join(', '),
  async () => {
    // given
    using environment = gateFixture()
    using fixture = deliveryFixture()
    const { run, dir } = fixture
    await refuseBuildCommit(run)
    const buildDir = join(run.sessionDir, 'build')
    mkdirSync(buildDir, { recursive: true })
    writeFileSync(join(buildDir, 'envelope.json'), JSON.stringify(work()))
    const config = configWithDelivery(dir, {
      ...environment.run.cfg,
      defaults: {
        ...environment.run.cfg.defaults,
        data_dir: join(dir, 'data'),
      },
      observability: {
        ...environment.run.cfg.observability,
        db: run.tracer.dbPath,
      },
    })
    // biome-ignore lint/plugin/no-object-mutation: this disposable environment owns the DB and registry overrides and restores both on disposal
    Object.assign(process.env, {
      CRUST_DB: run.tracer.dbPath,
      CRUST_REGISTRY: join(dir, 'workspaces.jsonl'),
    })
    const { ports, requests } = portsFor(() => work())
    const signals = {
      SIGINT: process.listeners('SIGINT'),
      SIGTERM: process.listeners('SIGTERM'),
    }
    try {
      // when
      const actual = await runWorkflow(
        { ...argsFor(config, run.runId), resume: true },
        plan,
        ports,
        () => ({ provider: 'fixture', modelId: 'model' }),
        async () => false,
      )

      // then
      expect(actual).toBe(EXIT.WAITING)
      expect(readRunState(run.tracer.dbPath, run.runId)?.status).toBe('waiting')
      expect(requests()).toEqual([])
      expect(
        run.tracer
          .activityRunsFor(run.runId)
          .some((row) => row.params.name === 'gh-pull-request'),
      ).toBe(false)
      expect(
        run.tracer.eventsNamed(run.runId, 'human_gate_open').at(-1),
      ).toMatchObject({ kind: 'delivery', cause: 'uncommitted' })
    } finally {
      for (const signal of ['SIGINT', 'SIGTERM'] as const) {
        for (const listener of process.listeners(signal)) {
          if (!signals[signal].includes(listener))
            process.removeListener(signal, listener)
        }
      }
    }
  },
)
