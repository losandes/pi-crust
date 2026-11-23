import { expect, test } from 'bun:test'
import type { TChangeOutcome, TTaskCommandResult } from '../typedefs/task'
import { changeReport, NO_TASKS_DECLARED } from './change-report'

const success: TTaskCommandResult = {
  command: 'true',
  passed: true,
  returncode: 0,
  timedOut: false,
  timeoutSeconds: 2,
  durationSeconds: 0,
  outputTail: '',
}
const outcome: TChangeOutcome = {
  declared: 2,
  existing: { build: 2, test: 1, review: 0 },
  unmatched: { test: ['unmatched'] },
  results: [
    {
      name: 'pass',
      selected: { build: ['a'] },
      commands: [success],
      passed: true,
      outputArtifact: '',
    },
    {
      name: 'fail',
      selected: { build: ['b'] },
      commands: [
        success,
        {
          ...success,
          command: 'false',
          returncode: 1,
          passed: false,
          outputTail: 'failed \n',
        },
        {
          ...success,
          command: 'sleep 5',
          returncode: 124,
          passed: false,
          timedOut: true,
        },
      ],
      passed: false,
      outputArtifact: '',
    },
  ],
}

for (const { instance, evaluated, expected } of [
  {
    instance: 'build',
    evaluated: outcome,
    expected: {
      checks: [
        { item: 'task pass', ok: true, note: '1 command(s) exited 0' },
        {
          item: 'task fail',
          ok: false,
          note: '`false` exited 1\nfailed\n`sleep 5` timed out after 2s',
        },
      ],
    },
  },
  {
    instance: 'test',
    evaluated: outcome,
    expected: {
      checks: [
        { item: 'tasks', ok: true, note: 'no task ran over 1 changed path(s)' },
      ],
    },
  },
  {
    instance: 'test',
    evaluated: { ...outcome, declared: 0, results: [] },
    expected: {
      checks: [{ item: 'tasks', ok: true, note: NO_TASKS_DECLARED }],
    },
  },
  { instance: 'review', evaluated: outcome, expected: undefined },
]) {
  test(
    [
      `given an evaluation for ${instance} with ${evaluated.declared} declarations`,
      'when reporting the instance',
      'it should report only its selected tasks or explain why none ran',
    ].join(', '),
    () => {
      // given
      // when
      const actual = changeReport(evaluated, instance)
      // then
      expect(actual).toEqual(expected)
    },
  )
}
