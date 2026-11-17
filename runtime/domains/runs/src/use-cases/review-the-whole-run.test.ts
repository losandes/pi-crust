import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { TActivityContext, TRun } from '../../../../lib/contracts'
import {
  buildOutputSchema,
  crustConfigSchema,
  reviewOutputSchema,
} from '../../../../lib/contracts'
import { runWithTracer } from '../../../../testing/fake-activity'
import { SKIP_INTEGRATION } from '../../../../testing/integration'
import {
  restoreTerminal,
  silenceTerminal,
} from '../../../../testing/terminal-capture'
import type { TAgentPorts } from '../../../activities'
import { liveAgent, runnableActivities } from '../../../activities'
import type { TPiRequest } from '../../../agents'
import { emptyUsage } from '../../../agents'
import { RUN_START, recordRunStart, runChangeBase } from '../../../policy'
import { resolveBaseBranch, selectedPaths } from '../../../workspace'
import { createRun } from './create-run'
import { recordRequest } from './run-activities'
import { runActivityRun } from './run-activity-run'

type TStep = Readonly<{
  name: string
  edits?: Readonly<Record<string, string | undefined>>
  reported?: readonly string[]
  commit?: boolean
  fail?: boolean
  reject?: boolean
}>
type TScenario = Readonly<{
  title: string
  tag: string
  before?: Readonly<Record<string, string>>
  steps: readonly TStep[]
  expected: readonly string[]
  judge?: string
  scope?: 'directory' | 'range'
  skill?: 'match' | 'miss'
  diff?: boolean
  resume?: boolean
}>
const CONTEXT = {
  status: 'success',
  facts: [],
  decisions: [],
  assumptions: [],
  unresolved: [],
  risks: [],
  objective_met: { met: true, evidence: 'fixture' },
  regress_to: { activity: '', because: '' },
  summary: 'fixture',
}
const verdict = reviewOutputSchema.parse({
  ...CONTEXT,
  approved: true,
  findings: [],
  blocking: [],
})
const edit = (
  root: string,
  edits: Readonly<Record<string, string | undefined>>,
) => {
  for (const [path, text] of Object.entries(edits)) {
    const absolute = join(root, path)
    if (text === undefined) rmSync(absolute)
    else {
      mkdirSync(dirname(absolute), { recursive: true })
      writeFileSync(absolute, text)
    }
  }
}

const scenarios: readonly TScenario[] = [
  {
    tag: 'SC1',
    title: 'Two writing Activities ran before the review',
    steps: [
      {
        name: 'build',
        edits: { 'src/a.ts': 'built\n' },
        reported: ['src/a.ts'],
      },
      {
        name: 'test',
        edits: { 'tests/a.test.ts': 'tested\n' },
        reported: ['tests/a.test.ts'],
      },
    ],
    expected: ['src/a.ts', 'tests/a.test.ts'],
  },
  {
    tag: 'SC1',
    title: 'A writing Activity changed a file it did not report',
    steps: [
      {
        name: 'build',
        edits: { 'src/a.ts': 'built\n', 'src/b.ts': 'unreported\n' },
        reported: ['src/a.ts'],
      },
    ],
    expected: ['src/a.ts', 'src/b.ts'],
  },
  {
    tag: 'SC1',
    title:
      "The run's work is committed and the last writing Activity reported nothing",
    steps: [
      {
        name: 'build',
        edits: { 'src/a.ts': 'built\n', 'src/b.ts': 'built\n' },
        commit: true,
      },
      { name: 'test', reported: [] },
    ],
    expected: ['src/a.ts', 'src/b.ts'],
  },
  {
    tag: 'SC1',
    title: 'Reviewers are asked again after a revise round',
    steps: [
      {
        name: 'build',
        edits: {
          'src/a.ts': 'built\n',
          'src/b.ts': 'built\n',
          'src/c.ts': 'built\n',
        },
      },
      { name: 'code-review', reject: true },
      {
        name: 'build',
        edits: { 'src/a.ts': 'revised\n', 'src/d.ts': 'added\n' },
      },
    ],
    expected: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'],
  },
  {
    tag: 'SC1',
    title: "A later attempt's report replaces an earlier one",
    steps: [
      { name: 'build', edits: { 'src/a.ts': 'built\n' } },
      { name: 'build', edits: { 'src/b.ts': 'failed attempt\n' }, fail: true },
      { name: 'build', reported: [] },
    ],
    expected: ['src/a.ts', 'src/b.ts'],
  },
  {
    tag: 'SC1',
    title: 'A writing Activity deleted a file',
    steps: [{ name: 'build', edits: { 'src/a.ts': undefined } }],
    expected: ['src/a.ts'],
  },
  {
    tag: 'SC2',
    title: 'The developer had unrelated uncommitted work before the run',
    before: { 'src/b.ts': 'developer\n', 'untouched-untracked': 'developer\n' },
    steps: [{ name: 'build', edits: { 'src/a.ts': 'built\n' } }],
    expected: ['src/a.ts'],
  },
  {
    tag: 'SC3',
    title: 'The planner reported its own plan document as a changed file',
    steps: [
      {
        name: 'writer-plan',
        edits: { 'handoff/plan.md': 'plan\n', 'session/notes': 'notes\n' },
        reported: ['handoff/plan.md'],
      },
      { name: 'build', edits: { 'src/a.ts': 'built\n' } },
    ],
    expected: ['src/a.ts'],
  },
  {
    tag: 'SC4',
    title: "The run's work was committed before the review",
    steps: [{ name: 'build', edits: { 'src/a.ts': 'built\n' }, commit: true }],
    expected: ['src/a.ts'],
    diff: true,
  },
  {
    tag: 'SC4',
    title: "Part of the run's work is committed and part is not",
    steps: [
      { name: 'build', edits: { 'src/a.ts': 'built\n' }, commit: true },
      { name: 'test', edits: { 'tests/a.test.ts': 'tested\n' } },
    ],
    expected: ['src/a.ts', 'tests/a.test.ts'],
    diff: true,
  },
  {
    tag: 'SC5',
    title: 'The instructions name one scope',
    steps: [
      { name: 'build', edits: { 'src/a.ts': 'built\n' } },
      {
        name: 'test',
        edits: { 'tests/a.test.ts': 'tested\n' },
        reported: ['tests/a.test.ts'],
      },
    ],
    expected: ['src/a.ts', 'tests/a.test.ts'],
    judge: 'outcome-review',
  },
  {
    tag: 'SC6',
    title: 'The developer named a directory as the scope',
    steps: [
      {
        name: 'build',
        edits: { 'src/a.ts': 'built\n', 'tests/a.test.ts': 'outside\n' },
      },
    ],
    expected: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'],
    scope: 'directory',
  },
  {
    tag: 'SC6',
    title: 'The developer named a range of commits as the scope',
    before: {},
    steps: [
      { name: 'build', edits: { 'src/a.ts': 'built\n' }, commit: true },
      { name: 'test', edits: { 'tests/a.test.ts': 'outside range\n' } },
    ],
    expected: ['src/a.ts'],
    scope: 'range',
  },
  {
    tag: 'SC7',
    title: "A review-only run over the developer's own uncommitted work",
    before: { 'src/a.ts': 'developer\n', 'src/b.ts': 'developer\n' },
    steps: [],
    expected: ['src/a.ts', 'src/b.ts'],
  },
  {
    tag: 'SC8',
    title:
      'A routing rule matches only what an earlier writing Activity changed',
    steps: [
      { name: 'build', edits: { 'src/a.ts': 'built\n' } },
      { name: 'test', edits: { 'tests/a.test.ts': 'tested\n' } },
    ],
    expected: ['src/a.ts', 'tests/a.test.ts'],
    skill: 'match',
  },
  {
    tag: 'SC8',
    title: "No routing rule matches the run's change",
    steps: [{ name: 'build', edits: { 'src/a.ts': 'built\n' } }],
    expected: ['src/a.ts'],
    skill: 'miss',
  },
  {
    tag: 'SC9',
    title: 'A repository adds a judging Activity under its own name',
    steps: [
      { name: 'build', edits: { 'src/a.ts': 'built\n' } },
      { name: 'test', edits: { 'tests/a.test.ts': 'tested\n' } },
    ],
    expected: ['src/a.ts', 'tests/a.test.ts'],
    judge: 'security-review',
  },
  {
    tag: 'SC10',
    title: 'The run was stopped and resumed before the review',
    steps: [{ name: 'build', edits: { 'src/a.ts': 'built\n' }, commit: true }],
    expected: ['src/a.ts'],
    skill: 'match',
    resume: true,
  },
]

for (const scenario of scenarios) {
  test.skipIf(SKIP_INTEGRATION)(
    [
      `given @${scenario.tag} ${scenario.title}`,
      'when a judging Activity starts through the real agent boundary',
      'it should receive the complete selected change and its reading instructions',
    ].join(', '),
    async () => {
      // given — each scenario carries its tag and exact identify title above
      const dir = mkdtempSync(join(tmpdir(), 'crust-whole-run-'))
      const previousCwd = process.cwd()
      const git = (...args: string[]) =>
        execFileSync('git', args, {
          cwd: dir,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        }).trim()
      let renders: Readonly<{
        path: string
        variables: Readonly<Record<string, string>>
      }>[] = []
      let requests: readonly TPiRequest[] = []
      let runToClose: TRun | undefined
      silenceTerminal()
      try {
        git('init', '-q')
        git('config', 'user.email', 'test@example.com')
        git('config', 'user.name', 'Test')
        git('config', 'commit.gpgsign', 'false')
        edit(dir, {
          '.gitignore': `data/\ncrust.db*\nevents.jsonl\n${scenario.tag === 'SC3' ? '' : 'session/\nhandoff/\n'}`,
          'src/a.ts': 'initial\n',
          'src/b.ts': 'initial\n',
          'src/c.ts': 'initial\n',
          'src/d.ts': 'initial\n',
          'tests/a.test.ts': 'initial\n',
        })
        git('add', '.')
        git('commit', '-qm', 'initial')
        const head = git('rev-parse', 'HEAD')
        edit(dir, scenario.before ?? {})
        if (scenario.tag === 'SC7')
          git('add', '--', ...Object.keys(scenario.before ?? {}))
        process.chdir(dir)
        const names = [
          'build',
          'test',
          'writer-plan',
          'code-review',
          'outcome-review',
          'security-review',
        ]
        const entries = names.map((name) => ({
          name,
          purpose: `Execute the ${name} scenario against fixture files`,
          output: name.endsWith('review') ? 'reviewOutput' : 'buildOutput',
          prompt_engineering: {
            system: `${name}/system`,
            user: `${name}/user`,
          },
          writes: ['*'],
          commit: false,
        }))
        const cfg = crustConfigSchema.parse({
          defaults: { data_dir: join(dir, 'data'), protected_files: [] },
          observability: { db: join(dir, 'crust.db') },
          activities: entries,
          agents: entries,
          routing: {
            skills: [
              {
                name: 'review',
                path: 'review-skill',
                agents: [scenario.judge ?? 'code-review'],
                when: scenario.skill === 'miss' ? ['never/**'] : ['src/**'],
              },
            ],
          },
        })
        const created = runWithTracer(dir, cfg)
        const run = {
          ...created,
          repoRoot: dir,
          vcsRoot: dir,
          sessionDir: join(dir, 'session'),
          contextHandoffDir: join(dir, 'handoff'),
        }
        runToClose = run
        run.tracer.sessionStart(run.runId, 'tester', 'compose')
        await recordRequest(run, 'implement', {}, (handle) =>
          recordRunStart(liveAgent)(run, handle.activityRun.activity_run_id),
        )
        let currentStep: TStep = { name: 'build' }
        const ports: TAgentPorts = {
          ...liveAgent,
          run: (request) => {
            requests = [...requests, request]
            edit(request.cwd, currentStep.edits ?? {})
            if (currentStep.commit) {
              git('add', '--', ...Object.keys(currentStep.edits ?? {}))
              git('commit', '-qm', 'work')
            }
            if (currentStep.fail)
              return Promise.reject(new Error('attempt failed after editing'))
            const envelope = currentStep.name.endsWith('review')
              ? {
                  ...verdict,
                  approved: !currentStep.reject,
                  blocking: currentStep.reject ? ['revise the work'] : [],
                }
              : buildOutputSchema.parse({
                  ...CONTEXT,
                  changed_files: currentStep.reported ?? [],
                })
            return Promise.resolve({
              text: JSON.stringify(envelope),
              returncode: 0,
              sessionId: 'fixture',
              tokens: 0,
              cost: 0,
              usage: emptyUsage,
              contextTokens: 0,
              contextWindow: 0,
            })
          },
          render: (path, variables) => {
            renders = [...renders, { path, variables }]
            return path
          },
          savePrompt: (directory, name) => join(directory, name),
        }
        const initialContext = (active: TRun): TActivityContext => ({
          run: active,
          prompt: 'implement',
          previous: undefined,
          previousStep: undefined,
          upstream: [],
          cohort: [],
          baseline: head,
          outcomes: [],
          feedback: [],
        })
        let context = initialContext(run)
        const execute = async (active: TRun, step: TStep, base = '') => {
          currentStep = step
          const activity = runnableActivities(
            [step.name],
            cfg,
            { base, committing: false },
            ports,
          )[0]
          if (!activity) throw new Error('missing activity')
          const result = await runActivityRun(active)(
            activity.params,
            (handle) => activity.execute({ ...context, run: active }, handle),
          )
          if (step.reject) expect(result.accepted).toBe(false)
          context = {
            ...context,
            run: active,
            previous: result.previous,
            previousStep: step.name,
          }
        }
        for (const step of scenario.steps) {
          if (step.fail)
            await expect(execute(run, step)).rejects.toThrow(
              'attempt failed after editing',
            )
          else await execute(run, step)
        }
        const scope =
          scenario.scope === 'directory'
            ? 'src/'
            : scenario.scope === 'range'
              ? `${head}..HEAD`
              : ''
        const judge = { name: scenario.judge ?? 'code-review' }
        // when
        await execute(run, judge, scope)
        const first = renders
          .filter((one) => one.path === `${judge.name}/user`)
          .at(-1)?.variables
        const firstSkills = requests.at(-1)?.skills
        if (scenario.resume) {
          const resumed = createRun({
            cfg,
            runId: run.runId,
            tracer: run.tracer,
            engineer: 'tester',
            resume: new Set(['request', 'build']),
          })
          const active = {
            ...resumed,
            repoRoot: dir,
            vcsRoot: dir,
            sessionDir: run.sessionDir,
            contextHandoffDir: run.contextHandoffDir,
          }
          await recordRequest(active, 'implement', {}, (handle) =>
            recordRunStart(liveAgent)(
              active,
              handle.activityRun.activity_run_id,
            ),
          )
          await execute(active, judge)
        }
        // then
        const actual = renders
          .filter((one) => one.path === `${judge.name}/user`)
          .at(-1)?.variables
        expect(actual?.changed_files).toBe(scenario.expected.join('\n'))
        expect(actual?.change_base).toBe(
          scope ||
            (scenario.steps.length === 0
              ? '(the uncommitted working tree)'
              : runChangeBase(head)),
        )
        if (scenario.scope)
          expect(actual?.changed_files).toBe(
            selectedPaths(resolveBaseBranch(cfg, ''))(scope).join('\n'),
          )
        if (scenario.skill)
          expect(requests.at(-1)?.skills).toEqual(
            scenario.skill === 'match' ? ['review-skill'] : [],
          )
        if (scenario.resume) {
          expect(actual?.changed_files).toBe(first?.changed_files)
          expect(actual?.change_base).toBe(first?.change_base)
          expect(requests.at(-1)?.skills).toEqual(firstSkills)
          expect(run.tracer.eventsNamed(run.runId, RUN_START)).toHaveLength(1)
        }
        if (scenario.diff) {
          const command = actual?.change_base?.match(
            /`git diff ([a-f0-9]+) -- <path>`/,
          )
          expect(command?.[1]).toBe(head)
          for (const path of scenario.expected) {
            const diff = git('diff', command?.[1] ?? '', '--', path)
            expect(diff).toContain(
              path.startsWith('tests/') ? '+tested' : '+built',
            )
          }
        }
      } finally {
        runToClose?.tracer.close()
        process.chdir(previousCwd)
        rmSync(dir, { recursive: true, force: true })
        restoreTerminal()
      }
    },
  )
}
