import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crustConfigSchema } from '../../../../lib/contracts'
import { SKIP_INTEGRATION } from '../../../../testing/integration'
import { liveTaskPorts, runChangeTasks } from '../../../tasks'
import { snapshotTree } from '../../../workspace'

test.skipIf(SKIP_INTEGRATION)(
  [
    'given a shell-sensitive file name discovered from Git',
    'when rendering tasks over the untracked and tracked edits',
    'it should pass the original file name verbatim as one shell argument',
  ].join(', '),
  async () => {
    // given
    const root = mkdtempSync(join(tmpdir(), 'crust-task-discovery-'))
    const git = (...args: readonly string[]) =>
      execFileSync('git', args, { cwd: root })
    const path = "a b; echo pwned $HOME's.ts"
    const roots = { workspaceRoot: root, vcsRoot: root }
    const artifact = join(root, '.git/task.log')
    const cfg = crustConfigSchema.parse({
      tasks: {
        check: {
          when: [{ on: 'change' }],
          run: 'set -- {{changed_paths}}; printf \'%s\\n\' "$#" "$1"',
        },
      },
    })
    const execute = (paths: readonly string[]) =>
      runChangeTasks(liveTaskPorts)({
        cfg,
        root,
        baseRef: '',
        contributions: [{ instance: 'build', activity: 'build', paths }],
        artifactFor: () => artifact,
        onCommandStart: () => undefined,
        onCommandEnd: () => undefined,
      })
    const changed = (before: Readonly<Record<string, string>>) =>
      Object.entries(snapshotTree(roots))
        .filter(([name, stat]) => before[name] !== stat)
        .map(([name]) => name)
    try {
      git('init', '-q')
      git(
        '-c',
        'user.name=test',
        '-c',
        'user.email=test@example.com',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '-qm',
        'initial',
        '--allow-empty',
      )
      const before = snapshotTree(roots)
      // when
      writeFileSync(join(root, path), 'first\n')
      const untracked = await execute(changed(before))
      const untrackedLog = readFileSync(artifact, 'utf8')
      git('add', '--', path)
      git(
        '-c',
        'user.name=test',
        '-c',
        'user.email=test@example.com',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '-qm',
        'track path',
      )
      writeFileSync(join(root, path), 'edited\n')
      const tracked = await execute(changed(before))
      const trackedLog = readFileSync(artifact, 'utf8')
      // then
      expect(untracked.results[0]?.passed).toBe(true)
      expect(tracked.results[0]?.passed).toBe(true)
      expect(untrackedLog).toContain(
        `--- stdout ---\n1\n${path}\n\n--- stderr ---`,
      )
      expect(trackedLog).toContain(
        `--- stdout ---\n1\n${path}\n\n--- stderr ---`,
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  },
)
