import { expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SKIP_INTEGRATION } from '../../../runtime/testing/integration'
import { openDatabase } from '../../sqlite'
import {
  claimRunDirectory,
  forgetRunDirectory,
  RUN_DIRECTORIES_SCHEMA,
  registeredRepositoryPath,
  resolveRunDirectory,
  runIdTaken,
  sessionsDirIn,
  type TRunStore,
} from './run-directories'

const scratch = () => {
  const root = mkdtempSync(join(tmpdir(), 'run-directories-'))
  return {
    root,
    store: {
      dbPath: join(root, 'db', 'crust.db'),
      sessionsDir: sessionsDirIn(root),
    },
    clean: () => rmSync(root, { recursive: true, force: true }),
  }
}
const sql = (store: TRunStore, statements: string) => {
  mkdirSync(join(store.dbPath, '..'), { recursive: true })
  const db = openDatabase(store.dbPath)
  try {
    db.exec(statements)
  } finally {
    db.close()
  }
}

test(
  [
    'given a missing registry',
    'when reading, claiming and forgetting nested runs',
    'it should resolve without creating runs and keep grouping reservations',
  ].join(', '),
  () => {
    // given
    const { store, clean } = scratch()
    try {
      // when, then
      expect(resolveRunDirectory(store)('one')).toBe(
        join(store.sessionsDir, 'one'),
      )
      expect(runIdTaken(store)('one')).toBe(false)
      forgetRunDirectory(store)('one')
      expect(existsSync(store.dbPath)).toBe(false)
      sql(store, 'CREATE TABLE unrelated (id TEXT PRIMARY KEY);')
      expect(registeredRepositoryPath(store)('one')).toBeUndefined()
      forgetRunDirectory(store)('one')
      expect(
        claimRunDirectory(store)('one', ['group', 'subgroup', 'repo']),
      ).toEqual({
        status: 'ok',
        data: join(store.sessionsDir, 'group', 'subgroup', 'repo', 'one'),
      })
      expect(existsSync(store.sessionsDir)).toBe(false)
      expect(runIdTaken(store)('one')).toBe(true)
      expect(registeredRepositoryPath(store)('one')).toEqual([
        'group',
        'subgroup',
        'repo',
      ])
      expect(resolveRunDirectory(store)('one')).toBe(
        join(store.sessionsDir, 'group', 'subgroup', 'repo', 'one'),
      )
      expect(claimRunDirectory(store)('one', ['other', 'repo'])).toEqual({
        status: 'ok',
        data: resolveRunDirectory(store)('one'),
      })
      forgetRunDirectory(store)('one')
      expect(runIdTaken(store)('one')).toBe(false)
      const db = openDatabase(store.dbPath)
      expect(
        db.query('SELECT path FROM repository_directories ORDER BY path').all(),
      ).toEqual([
        { path: 'group' },
        { path: 'group/subgroup' },
        { path: 'group/subgroup/repo' },
      ])
      db.close()
      mkdirSync(join(store.sessionsDir, 'flat'), { recursive: true })
      expect(runIdTaken(store)('flat')).toBe(true)
      expect(claimRunDirectory(store)('flat', ['other', 'repo'])).toEqual({
        status: 'ok',
        data: join(store.sessionsDir, 'flat'),
      })
      expect(registeredRepositoryPath(store)('flat')).toBeUndefined()
    } finally {
      clean()
    }
  },
)

for (const invalid of ['../outside', 'a//b', 'a/./b', '', 'a/\\b']) {
  test(
    [
      'given an invalid stored path',
      `when resolving and claiming ${JSON.stringify(invalid)}`,
      'it should fall back for reads and refuse writes without repair',
    ].join(', '),
    () => {
      // given
      const { store, clean } = scratch()
      try {
        sql(store, RUN_DIRECTORIES_SCHEMA)
        const db = openDatabase(store.dbPath)
        db.run('INSERT INTO run_directories VALUES (?, ?)', ['bad', invalid])
        db.close()
        // when
        const result = claimRunDirectory(store)('bad', ['a', 'b'])
        // then
        expect(result.status).toBe('error')
        expect(resolveRunDirectory(store)('bad')).toBe(
          join(store.sessionsDir, 'bad'),
        )
        expect(runIdTaken(store)('bad')).toBe(true)
        const reader = openDatabase(store.dbPath)
        expect(
          reader
            .query(
              'SELECT repository_dir FROM run_directories WHERE run_id = ?',
            )
            .get('bad'),
        ).toEqual({ repository_dir: invalid })
        expect(
          reader.query('SELECT path FROM repository_directories').all(),
        ).toEqual([])
        reader.close()
        expect(existsSync(store.sessionsDir)).toBe(false)
      } finally {
        clean()
      }
    },
  )
}

for (const kind of [
  'flat-row-and-disk',
  'flat-row',
  'flat-disk',
  'nested-run',
  'grouping-target',
  'target-disk',
  'grouping-flat',
  'invalid-input',
]) {
  test(
    [
      'given an overlapping placement',
      `when claiming against ${kind}`,
      'it should refuse without changing either registry or existing files',
    ].join(', '),
    () => {
      // given
      const { store, clean } = scratch()
      try {
        sql(store, RUN_DIRECTORIES_SCHEMA)
        if (kind.startsWith('flat-row'))
          sql(
            store,
            "CREATE TABLE sessions (run_id TEXT PRIMARY KEY); INSERT INTO sessions VALUES ('aaaa1111');",
          )
        if (kind === 'flat-row-and-disk' || kind === 'flat-disk')
          mkdirSync(join(store.sessionsDir, 'aaaa1111'), { recursive: true })
        if (kind === 'nested-run')
          expect(claimRunDirectory(store)('bbbb2222', ['a', 'b']).status).toBe(
            'ok',
          )
        if (kind === 'grouping-target')
          expect(
            claimRunDirectory(store)('bbbb2222', ['a', 'b', 'aaaa1111']).status,
          ).toBe('ok')
        if (kind === 'grouping-flat') {
          expect(
            claimRunDirectory(store)('bbbb2222', ['aaaa1111', 'tools']).status,
          ).toBe('ok')
          mkdirSync(join(store.sessionsDir, 'aaaa1111'), { recursive: true })
        }
        if (kind === 'target-disk')
          mkdirSync(join(store.sessionsDir, 'a', 'b', 'aaaa1111'), {
            recursive: true,
          })
        const path = kind.startsWith('flat-')
          ? ['aaaa1111', 'tools']
          : kind === 'nested-run'
            ? ['a', 'b', 'bbbb2222']
            : kind === 'invalid-input'
              ? ['..', 'outside']
              : ['a', 'b']
        const id =
          kind.startsWith('flat-') || kind === 'nested-run'
            ? 'newrun'
            : 'aaaa1111'
        const before = openDatabase(store.dbPath)
        const runs = before.query('SELECT * FROM run_directories').all()
        const groups = before
          .query('SELECT * FROM repository_directories')
          .all()
        before.close()
        // when
        const result = claimRunDirectory(store)(id, path)
        // then
        expect(result.status).toBe('error')
        if (result.status === 'error')
          expect(result.error.message).toContain(id)
        const after = openDatabase(store.dbPath)
        expect(after.query('SELECT * FROM run_directories').all()).toEqual(runs)
        expect(
          after.query('SELECT * FROM repository_directories').all(),
        ).toEqual(groups)
        after.close()
        expect(existsSync(join(store.sessionsDir, ...path, id))).toBe(
          kind === 'target-disk',
        )
      } finally {
        clean()
      }
    },
  )
}

test(
  [
    'given an unwritable database location',
    'when claiming a run',
    'it should return an error settlement',
  ].join(', '),
  () => {
    // given
    const { root, clean, store } = scratch()
    try {
      writeFileSync(join(root, 'file'), '')
      // when
      const result = claimRunDirectory({
        ...store,
        dbPath: join(root, 'file', 'db'),
      })('id', ['a', 'b'])
      // then
      expect(result.status).toBe('error')
    } finally {
      clean()
    }
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given two processes claiming overlapping paths',
    'when they race for 25 pairs without making directories',
    'it should register exactly one run in every pair',
  ].join(', '),
  async () => {
    // given
    const { root, store, clean } = scratch()
    const gate = join(root, 'go')
    const source = join(import.meta.dir, 'run-directories.ts')
    const children = ['a', 'b'].map((side) =>
      Bun.spawn(
        [
          'bun',
          '-e',
          `
    import { existsSync } from 'node:fs'
    import { claimRunDirectory } from ${JSON.stringify(source)}
    while (!existsSync(${JSON.stringify(gate)})) await Bun.sleep(5)
    for (let i = 0; i < 25; i++) {
      const side = ${JSON.stringify(side)}
      const result = claimRunDirectory(${JSON.stringify(store)})(side + i, side === 'a' ? ['o', 'r' + i] : ['o', 'r' + i, 'a' + i])
      console.log(result.status)
    }
  `,
        ],
        { stdout: 'pipe', stderr: 'pipe' },
      ),
    )
    try {
      // when
      writeFileSync(gate, 'go')
      const results = await Promise.allSettled(
        children.map(async (child) => ({
          code: await child.exited,
          out: (await new Response(child.stdout).text()).trim().split('\n'),
          err: await new Response(child.stderr).text(),
        })),
      )
      // then
      const statuses = results.map((result) => {
        expect(result.status).toBe('fulfilled')
        if (result.status !== 'fulfilled') throw result.reason
        expect(result.value.code).toBe(0)
        expect(result.value.err).toBe('')
        expect(result.value.out).toHaveLength(25)
        return result.value.out
      })
      for (let i = 0; i < 25; i++) {
        const a = registeredRepositoryPath(store)(`a${i}`) !== undefined
        const b = registeredRepositoryPath(store)(`b${i}`) !== undefined
        expect(Number(a) + Number(b)).toBe(1)
        expect(statuses[0]?.[i]).toBe(a ? 'ok' : 'error')
        expect(statuses[1]?.[i]).toBe(b ? 'ok' : 'error')
      }
      expect(existsSync(store.sessionsDir)).toBe(false)
    } finally {
      children.forEach((child) => {
        child.kill()
      })
      clean()
    }
  },
)

test(
  [
    'given a database that rejects the run insert',
    'when claiming after grouping prefixes have been inserted',
    'it should roll back every prefix and return an error settlement',
  ].join(', '),
  () => {
    // given
    const { store, clean } = scratch()
    try {
      sql(
        store,
        `${RUN_DIRECTORIES_SCHEMA} CREATE TRIGGER reject_claim BEFORE INSERT ON run_directories BEGIN SELECT RAISE(ABORT, 'fixture refusal'); END;`,
      )
      // when
      const result = claimRunDirectory(store)('id', ['owner', 'repo'])
      // then
      expect(result.status).toBe('error')
      const db = openDatabase(store.dbPath)
      expect(db.query('SELECT * FROM run_directories').all()).toEqual([])
      expect(db.query('SELECT * FROM repository_directories').all()).toEqual([])
      db.close()
      expect(existsSync(store.sessionsDir)).toBe(false)
    } finally {
      clean()
    }
  },
)
