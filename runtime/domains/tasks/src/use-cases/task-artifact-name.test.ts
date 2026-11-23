import { expect, test } from 'bun:test'
import { taskArtifactName } from './task-artifact-name'

test(
  [
    'given two task names that sanitize to the same string',
    'when deriving their log names',
    'it should prefix each name with its declaration position',
  ].join(', '),
  () => {
    // given
    const tasks = [
      { name: 'api:test', index: 1 },
      { name: 'api_test', index: 2 },
    ]
    // when
    const actual = tasks.map(taskArtifactName)
    // then
    expect(actual).toEqual(['01_api_test.log', '02_api_test.log'])
  },
)
