import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TRun } from '../../../../lib/contracts'
import {
  buildOutput,
  ENVELOPE_NAMES,
  envelopeNamed,
  genericOutput,
  violationsOf,
} from '../../../../lib/contracts'
import { activityChecks, outputChecks } from './output-checks'

const artifactNames = ['artifacts_exist', 'files_non_empty', 'json_parses']
const own: Readonly<Record<string, readonly string[]>> = {
  reviewOutput: ['verdict_consistent'],
  ghIssueOutput: ['issue_created'],
  diagnosisOutput: ['reproduction_supported'],
  buildOutput: ['diff_matches_claims'],
}

for (const name of ENVELOPE_NAMES) {
  test(
    [
      `given the published ${name} envelope`,
      'when deriving output checks',
      'it should attach exactly the artifact checks and its own schema check',
    ].join(', '),
    () => {
      // given
      const spec = envelopeNamed(name) ?? genericOutput
      // when
      const actual = outputChecks(spec).map((gate) => gate.name)
      // then
      expect(actual).toEqual([...artifactNames, ...(own[name] ?? [])])
    },
  )
}

for (const name of ['build', 'test-tdd']) {
  test(
    [
      `given a buildOutput Activity named ${name}`,
      'when deriving Activity checks',
      'it should run repository commands last except for test-tdd',
    ].join(', '),
    () => {
      // given
      const activity = { name, spec: buildOutput }
      // when
      const actual = activityChecks(activity).map((gate) => gate.name)
      // then
      expect(actual).toEqual([
        ...artifactNames,
        'diff_matches_claims',
        ...(name === 'test-tdd' ? [] : ['checks']),
      ])
    },
  )
}

test(
  [
    'given research reporting an existing non-empty handoff',
    'when judging its output',
    'it should pass without requiring issue, review, diagnosis or build fields',
  ].join(', '),
  () => {
    // given
    const dir = mkdtempSync(join(tmpdir(), 'crust-research-checks-'))
    writeFileSync(join(dir, 'research.md'), 'Findings and evidence.\n')
    const run = {
      repoRoot: dir,
      vcsRoot: dir,
      contextHandoffDir: dir,
    } as unknown as TRun
    const spec = envelopeNamed('researchOutput') ?? genericOutput
    const envelope = spec.schema.parse({
      status: 'success',
      summary: 'researched',
      artifacts: ['research.md'],
      facts: [],
      decisions: [],
      assumptions: [],
      unresolved: [],
      risks: [],
      findings: [],
      objective_met: { met: true, evidence: 'research.md' },
      regress_to: { activity: '', because: '' },
    })
    try {
      // when
      const actual = outputChecks(spec).flatMap((gate) =>
        violationsOf(gate.check(envelope, run, [])),
      )
      // then
      expect(actual).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
)
