import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  resolveRunDirectory,
  sessionsDirIn,
} from '../../../../../lib/run-directories'
import { tokenRepo } from '../../../../testing/token-repo'
import { readRunState } from '../../../trace'
import { steerBranch, steerOverwrite, type TSteerPorts } from './steer-run'

for (const mode of ['overwrite', 'branch'] as const) {
  for (const situation of [
    'missing-run',
    'missing-activity',
    'refused',
    'finished',
    'no-exit',
    'live',
    'seed-error',
  ] as const) {
    test(
      [
        `given ${mode} steering with ${situation}`,
        'when steering the recorded run',
        'it should preserve refusal, replay and exit-code behavior',
      ].join(', '),
      async () => {
        // given
        using fixture = tokenRepo()
        if (mode === 'branch' && situation === 'finished') {
          const db = new Database(fixture.dbPath)
          db.run(
            'INSERT INTO activity_runs (activity_run_id, run_id, seq, name, kind, owner, status) VALUES (?,?,?,?,?,?,?)',
            [
              `${fixture.runId}_00_plan`,
              fixture.runId,
              0,
              'plan',
              'agent',
              'builder',
              'success',
            ],
          )
          db.close()
        }
        if (situation === 'seed-error')
          writeFileSync(join(fixture.sessionDir, 'invocation.json'), 'not JSON')
        if (situation === 'live') {
          const db = new Database(fixture.dbPath)
          db.run("UPDATE sessions SET status='running'")
          db.run('INSERT INTO processes (run_id, kind, pid) VALUES (?,?,?)', [
            fixture.runId,
            'run',
            process.pid,
          ])
          db.close()
        }
        const ports: TSteerPorts = {
          repositoryPathAt: () => ['owner', 'repo'],
          say: () => undefined,
          now: () => '2024-01-02T00:00:00.000Z',
          resume: () => ({
            started: situation !== 'refused',
            command: 'fixture resume',
            reason: 'fixture refusal',
            ...(situation === 'no-exit'
              ? {}
              : { finished: Promise.resolve(7) }),
          }),
        }
        const params = {
          dbPath: fixture.dbPath,
          dataDir: join(fixture.root, '.pi-crust', 'data'),
          runId: situation === 'missing-run' ? 'missing' : fixture.runId,
          activity: situation === 'missing-activity' ? 'missing' : 'build',
          note: 'revise this work',
          seeding: 'fresh' as const,
          branchId: 'branch1',
        }

        // when
        const actual = await (mode === 'branch'
          ? steerBranch(ports)(params)
          : steerOverwrite(ports)(params))

        // then
        if (mode === 'branch' && situation === 'finished')
          expect(
            readRunState(fixture.dbPath, 'branch1')?.activityRuns.some(
              (one) => one.name === 'plan',
            ),
          ).toBe(true)
        const refused =
          situation === 'missing-run' ||
          situation === 'missing-activity' ||
          situation === 'refused' ||
          (mode === 'branch' &&
            (situation === 'live' || situation === 'seed-error'))
        expect(actual).toBe(refused ? 1 : situation === 'no-exit' ? 0 : 7)
        if (mode === 'branch' && situation === 'seed-error')
          expect(
            readFileSync(
              join(
                resolveRunDirectory({
                  dbPath: params.dbPath,
                  sessionsDir: sessionsDirIn(params.dataDir),
                })(params.branchId),
                'spawn.log',
              ),
              'utf8',
            ),
          ).toContain('branch failed:')
        if (mode === 'overwrite' && !refused)
          expect(
            readRunState(fixture.dbPath, fixture.runId)?.activityRuns[0]
              ?.status,
          ).toBe('superseded')
      },
    )
  }
}

for (const layout of ['flat', 'registered', 'refused'] as const) {
  test(
    [
      `given a branch source in ${layout} layout`,
      'when branching with a changed repository identity',
      'it should use the source placement, preserve source files and refuse conflicts',
    ].join(', '),
    async () => {
      // given
      const { claimRunDirectory } = await import(
        '../../../../../lib/run-directories'
      )
      const { cpSync, readdirSync, rmSync, mkdirSync } = await import('node:fs')
      using fixture = tokenRepo()
      const dataDir = join(fixture.root, '.pi-crust', 'data')
      const store = {
        dbPath: fixture.dbPath,
        sessionsDir: sessionsDirIn(dataDir),
      }
      const grouped = join(store.sessionsDir, 'owner', 'repo', fixture.runId)
      if (layout === 'registered') {
        cpSync(fixture.sessionDir, grouped, { recursive: true })
        rmSync(fixture.sessionDir, { recursive: true })
        expect(
          claimRunDirectory(store)(fixture.runId, ['owner', 'repo']).status,
        ).toBe('error')
        // Seed the fixture's pre-existing registry record, not a new placement over existing files.
        const db = new Database(fixture.dbPath)
        db.run('INSERT INTO run_directories VALUES (?, ?)', [
          fixture.runId,
          'owner/repo',
        ])
        db.run(
          "INSERT INTO repository_directories VALUES ('owner'), ('owner/repo')",
        )
        db.close()
      }
      const source = layout === 'registered' ? grouped : fixture.sessionDir
      const before = readdirSync(source, { recursive: true })
        .map(String)
        .toSorted()
      let invocations: readonly string[] = []
      let resumed = ''
      const branchId = 'newbranch'
      if (layout === 'refused')
        mkdirSync(join(store.sessionsDir, 'fresh', 'repo', branchId), {
          recursive: true,
        })
      const ports: TSteerPorts = {
        say: () => undefined,
        now: () => '2026-01-01T00:00:00.000Z',
        repositoryPathAt: (cwd) => {
          invocations = [...invocations, cwd]
          return ['fresh', 'repo']
        },
        resume: (dir) => {
          resumed = dir
          return {
            started: true,
            command: '',
            reason: '',
            finished: Promise.resolve(0),
          }
        },
      }
      // when
      const actual = await steerBranch(ports)({
        dbPath: fixture.dbPath,
        dataDir,
        runId: fixture.runId,
        activity: 'build',
        note: 'revise',
        seeding: 'fresh',
        branchId,
      })
      // then
      expect(actual).toBe(layout === 'refused' ? 1 : 0)
      expect(
        readdirSync(source, { recursive: true }).map(String).toSorted(),
      ).toEqual(before)
      if (layout === 'refused') expect(resumed).toBe('')
      else
        expect(resumed).toBe(
          join(
            store.sessionsDir,
            layout === 'registered' ? 'owner' : 'fresh',
            'repo',
            branchId,
          ),
        )
      expect(invocations).toHaveLength(layout === 'registered' ? 0 : 1)
    },
  )
}
