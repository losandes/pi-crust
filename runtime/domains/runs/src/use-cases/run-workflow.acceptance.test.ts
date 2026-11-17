import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { main as decide } from '../../../../decide'
import { EXIT, pullRequestOutput, type TStage } from '../../../../lib/contracts'
import { SKIP_INTEGRATION } from '../../../../testing/integration'
import { terminalOutput } from '../../../../testing/terminal-capture'
import type { TDeliveryPorts } from '../../../activities'
import { readRunState } from '../../../trace'
import { createRun } from './create-run'
import { gateFixture, portsFor, review, work } from './human-gate-fixture.test'
import { deliveryFixture, refuseBuildCommit } from './run-terminal-fixture.test'
import { runWorkflow } from './run-workflow'

const recordDecision = (...args: readonly string[]): void => {
  const source = new URL(
    '../../../../../apps/visualizer/server/writes.ts',
    import.meta.url,
  ).href
  execFileSync(
    'bun',
    [
      '-e',
      `import { recordDecision } from ${JSON.stringify(source)}; recordDecision(...${JSON.stringify(args)})`,
    ],
    { stdio: 'pipe' },
  )
}

const acceptanceFixture = (
  attempts = 1,
  withWriter = true,
  approved = false,
) => {
  const environment = gateFixture({ attempts })
  const repository = deliveryFixture()
  const { run, dir } = environment
  const system = join(dir, 'system.md')
  const user = join(dir, 'user.md')
  const terminal = {
    name: 'gh-pull-request',
    model: 'fixture/delivery',
    purpose: 'Deliver work',
    prompt_engineering: { system, user },
    writes: [],
  }
  const config = join(dir, 'acceptance.config.yaml')
  writeFileSync(
    config,
    Bun.YAML.stringify({
      ...run.cfg,
      defaults: { ...run.cfg.defaults, data_dir: dir },
      agents: [...run.cfg.agents, terminal],
      terminal: [terminal],
    }),
  )
  const runId = 'accept119'
  const handoff = join(dir, 'sessions', runId, 'context_handoff')
  const plan: readonly TStage[] = [
    {
      name: 'work',
      strategy: 'serial',
      activities: withWriter ? ['build', 'review'] : ['review'],
    },
    { name: 'deliver', strategy: 'serial', activities: ['gh-pull-request'] },
  ]
  const { ports, requests } = portsFor((model) =>
    model === 'fixture/review'
      ? review(approved ? { approved: true, blocking: [], findings: [] } : {})
      : model === 'fixture/delivery'
        ? pullRequestOutput.schema.parse({
            ...work(),
            title: 'Deliver work',
            body: 'Completed work',
          })
        : work(
            attempts > 1
              ? {
                  disputes: [
                    {
                      finding: 'Use the authorised retention window',
                      evidence: 'src/retention.ts:12',
                      reason: 'The authorised value is already used',
                    },
                  ],
                }
              : { changed_files: ['src/retention.ts'] },
          ),
  )
  let refused = false
  const delivery: TDeliveryPorts = {
    isRepo: () => true,
    branch: () => 'topic',
    remoteExists: () => true,
    baseRef: () => 'main',
    commitsAhead: () => 1,
    push: () => {
      if (refused) throw new Error('SSH agent unavailable')
    },
    uncommitted: () => [],
    forge: {
      authenticated: () => true,
      whoami: () => 'tester',
      find: () => '',
      create: () => 'https://github.com/example/repo/pull/119',
      update: () => '',
    },
  }
  const execute = (resume = false) =>
    runWorkflow(
      {
        prompt: 'Implement issue #119',
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
    handoff,
    config,
    execute,
    requests,
    refuseCommit: () =>
      refuseBuildCommit(
        createRun({
          cfg: { ...run.cfg, defaults: { ...run.cfg.defaults, data_dir: dir } },
          runId,
          tracer: run.tracer,
          engineer: 'tester',
        }),
      ),
    refusePush: (value: boolean) => {
      refused = value
    },
    rows: () => run.tracer.activityRunsFor(runId),
    gates: () => run.tracer.eventsNamed(runId, 'human_gate_open'),
    state: () => readRunState(run.tracer.dbPath, runId)?.status,
    [Symbol.dispose]: () => {
      repository[Symbol.dispose]()
      environment[Symbol.dispose]()
    },
  }
}

test.skipIf(SKIP_INTEGRATION)(
  [
    'given an accepted run',
    'when the terminal Activity is reached',
    'it should deliver normally without opening an acceptance gate',
  ].join(', '),
  async () => {
    // given
    using fixture = acceptanceFixture(1, true, true)

    // when
    const actual = await fixture.execute()

    // then
    expect(actual).toBe(EXIT.SUCCESS)
    expect(fixture.state()).toBe('success')
    expect(fixture.gates()).toEqual([])
    expect(fixture.rows().at(-1)?.params.name).toBe('gh-pull-request')
  },
)

for (const scenario of [
  {
    name: 'exhausted revise budget',
    attempts: 1,
    writer: true,
    reason: 'attempts left',
  },
  {
    name: 'deadlocked revise loop',
    attempts: 4,
    writer: true,
    reason: 'neither side added evidence',
  },
  {
    name: 'rejecting review without a reviser',
    attempts: 1,
    writer: false,
    reason: 'not approved',
  },
]) {
  test.skipIf(SKIP_INTEGRATION)(
    [
      `given a ${scenario.name}`,
      'when the terminal Activity is reached',
      'it should wait with the settled reason and no terminal row',
    ].join(', '),
    async () => {
      // given
      using fixture = acceptanceFixture(scenario.attempts, scenario.writer)

      // when
      const actual = await fixture.execute()

      // then
      expect(actual).toBe(EXIT.WAITING)
      expect(fixture.state()).toBe('waiting')
      expect(
        fixture.rows().filter((row) => row.params.name === 'gh-pull-request'),
      ).toEqual([])
      expect(fixture.gates().at(-1)).toMatchObject({ kind: 'acceptance' })
      const request = readFileSync(
        join(fixture.handoff, 'decision-request.md'),
        'utf8',
      )
      expect(request).toContain(scenario.reason)
      if (scenario.writer) expect(request).toContain('disputes.md')
      expect(
        fixture
          .requests()
          .some((request) => request.model === 'fixture/delivery'),
      ).toBe(false)
    },
  )
}

for (const surface of ['cli', 'web'] as const) {
  for (const verb of ['approve', 'answer', 'reject'] as const) {
    test.skipIf(SKIP_INTEGRATION)(
      [
        `given an unaccepted run answered with ${verb} through ${surface}`,
        'when resumed',
        'it should honour the decision without running any work or review again',
      ].join(', '),
      async () => {
        // given
        using fixture = acceptanceFixture()
        expect(await fixture.execute()).toBe(EXIT.WAITING)
        const before = fixture.rows().length
        const opened = fixture.gates().at(-1)?.opened_at
        expect(typeof opened).toBe('string')
        // The surfaces run in a later process or HTTP request in production.
        await Bun.sleep(2)
        if (surface === 'cli') {
          const answer = join(fixture.handoff, 'answers.md')
          writeFileSync(answer, 'Accept these findings')
          // Resume is driven in-process below, with controlled external ports.
          rmSync(join(fixture.handoff, '..', 'invocation.json'))
          expect(
            await decide([
              verb,
              fixture.runId,
              '--config',
              fixture.config,
              '--db',
              fixture.run.tracer.dbPath,
              '--note',
              'Do not deliver',
              '--file',
              answer,
            ]),
          ).toBe(EXIT.SUCCESS)
        } else {
          recordDecision(
            fixture.run.tracer.dbPath,
            fixture.runId,
            verb,
            'Operator decision',
            'alice',
          )
        }

        const record = JSON.parse(
          readFileSync(join(fixture.handoff, 'decision-answer.json'), 'utf8'),
        )
        expect(record).toMatchObject({ verb, from: expect.any(String) })
        expect(Date.parse(record.at)).toBeGreaterThan(
          Date.parse(String(opened)),
        )

        // when
        const actual = await fixture.execute(true)

        // then
        expect(actual).toBe(verb === 'reject' ? EXIT.FAILED : EXIT.SUCCESS)
        expect(fixture.state()).toBe(verb === 'reject' ? 'fail' : 'success')
        expect(
          fixture
            .rows()
            .slice(before)
            .map((row) => [row.params.name, row.status]),
        ).toEqual([
          ['gh-pull-request', verb === 'reject' ? 'cancelled' : 'success'],
        ])
        expect(fixture.gates()).toHaveLength(1)
        if (verb === 'reject') {
          expect(
            fixture.run.tracer
              .eventsNamed(fixture.runId, 'terminal_cancelled')
              .at(-1)?.reason,
          ).toContain('person rejected')
        } else {
          expect(
            fixture.run.tracer
              .eventsNamed(fixture.runId, 'human_accepted')
              .at(-1),
          ).toMatchObject({
            verb,
            from: expect.any(String),
            reason: expect.stringContaining('disputes.md'),
          })
        }
      },
    )
  }
}

test.skipIf(SKIP_INTEGRATION)(
  [
    'given approval followed by a refused push',
    'when the run resumes again after delivery is repaired',
    'it should retain acceptance across the newer delivery gate and deliver without revising',
  ].join(', '),
  async () => {
    // given
    using fixture = acceptanceFixture()
    expect(await fixture.execute()).toBe(EXIT.WAITING)
    await Bun.sleep(2)
    recordDecision(
      fixture.run.tracer.dbPath,
      fixture.runId,
      'approve',
      '',
      'alice',
    )
    fixture.refusePush(true)
    expect(await fixture.execute(true)).toBe(EXIT.WAITING)
    expect(fixture.gates().map((gate) => gate.kind)).toEqual([
      'acceptance',
      'delivery',
    ])
    const before = fixture.rows().length
    fixture.refusePush(false)

    // when
    const actual = await fixture.execute(true)

    // then
    expect(actual).toBe(EXIT.SUCCESS)
    expect(fixture.state()).toBe('success')
    expect(fixture.gates().map((gate) => gate.kind)).toEqual([
      'acceptance',
      'delivery',
    ])
    expect(
      fixture
        .rows()
        .slice(before)
        .map((row) => row.params.name),
    ).toEqual(['gh-pull-request'])
    expect(
      fixture
        .rows()
        .filter((row) => row.params.name === 'gh-pull-request')
        .map((row) => row.status),
    ).toEqual(['superseded', 'success'])
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given acceptance followed by an outstanding commit',
    'when signing is repaired and the run resumes after the delivery gate',
    'it should retry the commit and deliver without revising or asking for acceptance again',
  ].join(', '),
  async () => {
    // given
    using fixture = acceptanceFixture()
    expect(await fixture.execute()).toBe(EXIT.WAITING)
    const hook = await fixture.refuseCommit()
    await Bun.sleep(2)
    recordDecision(
      fixture.run.tracer.dbPath,
      fixture.runId,
      'approve',
      '',
      'alice',
    )
    expect(await fixture.execute(true)).toBe(EXIT.WAITING)
    expect(fixture.gates().map((gate) => gate.kind)).toEqual([
      'acceptance',
      'delivery',
    ])
    expect(
      fixture.rows().some((row) => row.params.name === 'gh-pull-request'),
    ).toBe(false)
    const before = fixture.rows().length
    rmSync(hook)

    // when
    const actual = await fixture.execute(true)

    // then
    expect(actual).toBe(EXIT.SUCCESS)
    expect(fixture.state()).toBe('success')
    expect(fixture.gates().map((gate) => gate.kind)).toEqual([
      'acceptance',
      'delivery',
    ])
    expect(
      fixture
        .rows()
        .slice(before)
        .map((row) => row.params.name),
    ).toEqual(['gh-pull-request'])
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given a corrupt decision answer record at the acceptance gate',
    'when resumed',
    'it should explain the unreadable answer and stay waiting without revising or delivering',
  ].join(', '),
  async () => {
    // given
    using fixture = acceptanceFixture()
    expect(await fixture.execute()).toBe(EXIT.WAITING)
    writeFileSync(join(fixture.handoff, 'decision-answer.json'), '{')
    const before = fixture.rows().length

    // when
    const actual = await fixture.execute(true)

    // then
    expect(actual).toBe(EXIT.WAITING)
    expect(fixture.state()).toBe('waiting')
    expect(fixture.rows()).toHaveLength(before)
    expect(terminalOutput()).toContain('could not read decision-answer.json')
    expect(
      fixture.run.tracer.eventsNamed(fixture.runId, 'human_accepted'),
    ).toEqual([])
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given an answer recorded before the acceptance gate',
    'when resumed',
    'it should remain waiting and not treat the older approval as acceptance',
  ].join(', '),
  async () => {
    // given
    using fixture = acceptanceFixture()
    expect(await fixture.execute()).toBe(EXIT.WAITING)
    writeFileSync(
      join(fixture.handoff, 'decision-answer.json'),
      JSON.stringify({
        verb: 'approve',
        at: '2000-01-01T00:00:00.000Z',
        from: 'alice',
      }),
    )
    const before = fixture.rows().length

    // when
    const actual = await fixture.execute(true)

    // then
    expect(actual).toBe(EXIT.WAITING)
    expect(fixture.state()).toBe('waiting')
    expect(fixture.rows()).toHaveLength(before)
    expect(fixture.gates().map((gate) => gate.kind)).toEqual([
      'acceptance',
      'acceptance',
    ])
    expect(
      fixture.run.tracer.eventsNamed(fixture.runId, 'human_accepted'),
    ).toEqual([])
  },
)
