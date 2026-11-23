import { expect, test } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  activityRunParams,
  EXIT,
  operatorPlanOutput,
  pullRequestOutput,
  type TStage,
} from '../../../../lib/contracts'
import { configText } from '../../../../testing/config-document'
import { SKIP_INTEGRATION } from '../../../../testing/integration'
import type { TDeliveryPorts } from '../../../activities'
import { readRunState } from '../../../trace'
import { gateFixture, portsFor, review, work } from './human-gate-fixture.test'
import { deliveryFixture, failingCommitHook } from './run-terminal-fixture.test'
import { runWorkflow } from './run-workflow'

const setup = (
  options: Readonly<{
    terminal?: boolean
    failing?: boolean
    changes?: boolean
    rejected?: boolean
    commitRefused?: boolean
    concurrent?: boolean
    operator?: boolean
  }> = {},
) => {
  const environment = gateFixture({ attempts: 1 })
  const repository = deliveryFixture()
  const { run, dir } = environment
  const runId = '193de11a'
  const terminal = {
    name: 'gh-pull-request',
    model: 'fixture/delivery',
    purpose: 'Deliver the verified work',
    prompts: dir,
    writes: [],
  }
  const planners = options.operator
    ? [
        {
          ...terminal,
          name: 'operator',
          model: 'fixture/operator',
          purpose: 'Choose the verification fixture chain',
          writes: ['*'],
        },
      ]
    : []
  const config = join(dir, 'moments.config.toml')
  const activities = run.cfg.activities.map((activity) => ({
    ...activity,
    writes: ['*'],
    commit: options.commitRefused === true && activity.name === 'build',
  }))
  writeFileSync(
    config,
    configText({
      ...run.cfg,
      defaults: { ...run.cfg.defaults, data_dir: dir },
      activities,
      agents: [...activities, ...planners, terminal],
      planners,
      terminal: [terminal],
      tasks: {
        verify: {
          when: [{ on: 'deliver' }],
          match: ['work.txt'],
          run: `printf '%s\\n' {{changed_paths}}; test ! -f ${join(repository.dir, 'fail')}`,
        },
      },
    }),
  )
  if (options.failing) writeFileSync(join(repository.dir, 'fail'), '')
  if (options.commitRefused) failingCommitHook(repository.dir)
  const base = portsFor((model, attempt) => {
    if (model === 'fixture/delivery')
      return pullRequestOutput.schema.parse({
        ...work(),
        title: 'Verified work',
        body: 'All tasks passed',
      })
    if (model === 'fixture/operator') {
      writeFileSync(join(repository.dir, 'work.txt'), 'operator change\n')
      return operatorPlanOutput.schema.parse({ ...work(), steps: ['build'] })
    }
    if (model === 'fixture/review')
      return review({
        approved: !options.rejected,
        findings: options.rejected
          ? [{ requirement: 'repair work', met: false, evidence: 'work.txt:1' }]
          : [],
        blocking: options.rejected ? ['repair work'] : [],
      })
    if (options.changes !== false)
      writeFileSync(join(repository.dir, 'work.txt'), `version ${attempt}\n`)
    return work({
      changed_files: options.changes === false ? [] : ['work.txt'],
      commit_message: 'fix: exercise refused commit',
    })
  })
  const ports = {
    ...base.ports,
    snapshot: () => ({
      'work.txt': readFileSync(join(repository.dir, 'work.txt'), 'utf8'),
    }),
  }
  const external = new Map<string, number>()
  const delivery: TDeliveryPorts = {
    defaultBranch: () => '',
    isRepo: () => true,
    branch: () => 'topic',
    pushDefault: () => '',
    remotes: () => [],
    remoteExists: () => true,
    baseRef: () => 'main',
    commitsAhead: () => 1,
    push: () => {
      expect(run.tracer.eventsNamed(runId, 'task:verify').at(-1)?.passed).toBe(
        options.changes === false ? undefined : true,
      )
      external.set('push', (external.get('push') ?? 0) + 1)
    },
    uncommitted: () => [],
    forge: {
      authenticated: () => true,
      whoami: () => 'tester',
      find: () => '',
      create: () => {
        external.set('create', 1)
        return 'https://github.com/example/repo/pull/193'
      },
      update: () => '',
    },
  }
  const plan: readonly TStage[] = [
    {
      name: 'work',
      strategy: options.concurrent ? 'concurrent' : 'serial',
      activities: options.operator
        ? ['operator']
        : options.rejected || options.concurrent
          ? ['build', 'review']
          : ['build'],
    },
    ...(options.terminal === false
      ? []
      : [
          {
            name: 'delivery',
            strategy: 'serial' as const,
            activities: ['gh-pull-request'],
          },
        ]),
  ]
  const execute = (resume = false) =>
    runWorkflow(
      {
        prompt: 'Implement #193',
        config,
        runId,
        resume,
        base: undefined,
        activities: undefined,
        lifecycle: undefined,
        models: undefined,
        approveAfter: undefined,
        commit: undefined,
        stream: false,
        trustLevel: undefined,
        handoff: undefined,
        name: undefined,
      },
      plan,
      ports,
      () => ({ provider: 'fixture', modelId: 'model' }),
      async () => false,
      delivery,
    )
  return {
    run,
    runId,
    repository,
    execute,
    external,
    requests: base.requests,
    handoff: join(dir, 'sessions', runId, 'context_handoff'),
    [Symbol.dispose]: () => {
      repository[Symbol.dispose]()
      environment[Symbol.dispose]()
    },
  }
}

test.skipIf(SKIP_INTEGRATION)(
  [
    'given a replayed operator plan that changed repository files',
    'when executing its chosen chain',
    'it should defer deliver until the planned fold finishes',
  ].join(', '),
  async () => {
    // given
    using f = setup({ terminal: false, operator: true })
    const history = join(f.handoff, '..', 'envelope-history', 'operator')
    mkdirSync(history, { recursive: true })
    writeFileSync(
      join(history, 'envelope.json'),
      JSON.stringify(
        operatorPlanOutput.schema.parse({ ...work(), steps: ['build'] }),
      ),
    )
    f.run.tracer.sessionStart(f.runId, 'tester', 'compose')
    f.run.tracer.activityRunUpsert({
      activity_run_id: 'operator-row',
      run_id: f.runId,
      seq: 1,
      params: activityRunParams({
        name: 'operator',
        kind: 'agent',
        owner: 'operator',
        description: 'Choose the fixture chain before it executes.',
      }),
      status: 'success',
      error: undefined,
      started_at: undefined,
      ended_at: undefined,
    })
    f.run.tracer.event({
      run_id: f.runId,
      activity_run_id: 'operator-row',
      type: 'log',
      name: 'paths_touched',
      payload: {
        activity: 'operator',
        activity_run_id: 'operator-row',
        agent: 'operator',
        paths: ['work.txt'],
        dirty_before: [],
        claimed: [],
      },
    })
    // when
    const actual = await f.execute(true)
    // then
    expect(actual).toBe(EXIT.SUCCESS)
    expect(f.run.tracer.eventsNamed(f.runId, 'task:verify')).toHaveLength(1)
    expect(
      f.run.tracer.eventsNamed(f.runId, 'task:verify')[0]?.instances,
    ).toEqual(['build'])
    expect(f.requests().map((request) => request.model)).toEqual([
      'fixture/build',
    ])
  },
)

for (const terminal of [true, false]) {
  test.skipIf(SKIP_INTEGRATION)(
    [
      `given ${terminal ? '@SC1' : '@SC2'} a writing chain ${terminal ? 'with' : 'without'} a terminal`,
      'when completing its work',
      'it should verify before delivery or final success',
    ].join(', '),
    async () => {
      // given
      using f = setup({ terminal })
      // when
      const actual = await f.execute()
      // then
      expect(actual).toBe(EXIT.SUCCESS)
      expect(f.run.tracer.eventsNamed(f.runId, 'task:verify')).toHaveLength(1)
      expect(f.external.get('push') ?? 0).toBe(terminal ? 1 : 0)
      const rows = f.run.tracer.activityRunsFor(f.runId)
      expect(rows.at(-1)?.params.name).toBe(
        terminal ? 'gh-pull-request' : 'build',
      )
    },
  )

  test.skipIf(SKIP_INTEGRATION)(
    [
      `given @SC2 exhausted writing work and a failing task with terminal=${terminal}`,
      'when completing the chain',
      'it should finish failed naming the task without a terminal row or push',
    ].join(', '),
    async () => {
      // given
      using f = setup({ terminal, failing: true })
      // when
      const actual = await f.execute()
      // then
      expect(actual).not.toBe(EXIT.SUCCESS)
      expect(readRunState(f.run.tracer.dbPath, f.runId)?.status).toBe('fail')
      expect(
        f.run.tracer.eventsNamed(f.runId, 'regression_exhausted')[0]?.reason,
      ).toContain('verify')
      expect(
        f.run.tracer
          .activityRunsFor(f.runId)
          .some((row) => row.params.name === 'gh-pull-request'),
      ).toBe(false)
      expect(f.external.size).toBe(0)
    },
  )
}

test.skipIf(SKIP_INTEGRATION)(
  [
    'given @SC3 a chain that changes no repository files',
    'when finishing',
    'it should run no deliver task and retain success',
  ].join(', '),
  async () => {
    // given
    using f = setup({ terminal: false, changes: false })
    // when
    const actual = await f.execute()
    // then
    expect(actual).toBe(EXIT.SUCCESS)
    expect(f.run.tracer.eventsNamed(f.runId, 'task:verify')).toEqual([])
    expect(f.run.tracer.eventsNamed(f.runId, 'tasks:deliver')).toEqual([])
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given @SC12 a directly composed chain with a concurrent stage',
    'when its siblings finish',
    'it should verify the whole change before success',
  ].join(', '),
  async () => {
    // given
    using f = setup({ terminal: false, concurrent: true })
    // when
    const actual = await f.execute()
    // then
    expect(actual).toBe(EXIT.SUCCESS)
    expect(f.run.tracer.eventsNamed(f.runId, 'task:verify')).toHaveLength(1)
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given @SC13 a blocked deliver task',
    'when the operator repairs and resumes',
    'it should verify again before the first push',
  ].join(', '),
  async () => {
    // given
    using f = setup({ failing: true })
    expect(await f.execute()).not.toBe(EXIT.SUCCESS)
    rmSync(join(f.repository.dir, 'fail'))
    // when
    const actual = await f.execute(true)
    // then
    expect(actual).toBe(EXIT.SUCCESS)
    expect(
      f.run.tracer
        .eventsNamed(f.runId, 'task:verify')
        .map((event) => event.passed),
    ).toEqual([false, true])
    expect(f.external.get('push')).toBe(1)
    expect(
      f.requests().filter((request) => request.model === 'fixture/build'),
    ).toHaveLength(1)
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given @SC13 a rejected run subsequently accepted by its operator',
    'when deliver blocks the acceptance resume and a later resume repairs it',
    'it should reevaluate deliver on both resumes and only then push',
  ].join(', '),
  async () => {
    // given
    using f = setup({ rejected: true, failing: true })
    expect(await f.execute()).toBe(EXIT.WAITING)
    writeFileSync(
      join(f.handoff, 'decision-answer.json'),
      JSON.stringify({
        verb: 'approve',
        at: new Date(Date.now() + 1000).toISOString(),
        from: 'tester',
      }),
    )
    const calls = f.requests().length
    // when
    const blocked = await f.execute(true)
    rmSync(join(f.repository.dir, 'fail'))
    const actual = await f.execute(true)
    // then
    expect(blocked).not.toBe(EXIT.SUCCESS)
    expect(actual).toBe(EXIT.SUCCESS)
    expect(
      f.run.tracer
        .eventsNamed(f.runId, 'task:verify')
        .map((event) => event.passed),
    ).toEqual([false, true])
    expect(f.requests().length).toBe(calls + 1)
    expect(f.external.get('push')).toBe(1)
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given @SC11 a hook-refused commit and a passing whole-change task',
    'when reaching delivery',
    'it should verify uncommitted work without rerunning the writer',
  ].join(', '),
  async () => {
    // given
    using f = setup({ commitRefused: true })
    // when
    const actual = await f.execute()
    // then
    expect(actual).toBe(EXIT.WAITING)
    expect(
      f.run.tracer.eventsNamed(f.runId, 'task:verify').at(-1)?.passed,
    ).toBe(true)
    expect(
      f.requests().filter((request) => request.model === 'fixture/build'),
    ).toHaveLength(1)
    expect(f.run.tracer.eventsNamed(f.runId, 'regression')).toEqual([])
    expect(f.external.size).toBe(0)
  },
)
