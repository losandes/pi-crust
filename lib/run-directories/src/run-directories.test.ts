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

for (const databaseExists of [false, true]) {
  for (const operation of ['resolve', 'registered', 'taken'] as const) {
    test(
      [
        `given an unregistered run with databaseExists=${databaseExists}`,
        `when performing the ${operation} lookup`,
        'it should report the unregistered placement',
      ].join(', '),
      () => {
        // given
        const { store, clean } = scratch()
        try {
          if (databaseExists)
            sql(store, 'CREATE TABLE unrelated (id TEXT PRIMARY KEY);')
          const lookup = {
            resolve: () => resolveRunDirectory(store)('one'),
            registered: () => registeredRepositoryPath(store)('one'),
            taken: () => runIdTaken(store)('one'),
          }
          const expected = {
            resolve: join(store.sessionsDir, 'one'),
            registered: undefined,
            taken: false,
          }

          // when
          const actual = lookup[operation]()

          // then
          expect(actual).toEqual(expected[operation])
          expect(existsSync(store.dbPath)).toBe(databaseExists)
        } finally {
          clean()
        }
      },
    )
  }

  test(
    [
      `given no registry table with databaseExists=${databaseExists}`,
      'when forgetting an unknown run',
      'it should leave the store uninitialised',
    ].join(', '),
    () => {
      // given
      const { store, clean } = scratch()
      try {
        if (databaseExists)
          sql(store, 'CREATE TABLE unrelated (id TEXT PRIMARY KEY);')

        // when
        forgetRunDirectory(store)('one')
        const tables = databaseExists ? openDatabase(store.dbPath) : undefined
        const names = tables
          ?.query("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all()
        tables?.close()

        // then
        expect(existsSync(store.dbPath)).toBe(databaseExists)
        expect(names).toEqual(
          databaseExists ? [{ name: 'unrelated' }] : undefined,
        )
      } finally {
        clean()
      }
    },
  )
}

test(
  [
    'given a new run beneath a nested owner',
    'when claiming its directory',
    'it should reserve its placement without creating the run directory',
  ].join(', '),
  () => {
    // given
    const { store, clean } = scratch()
    try {
      // when
      const actual = claimRunDirectory(store)('one', [
        'group',
        'subgroup',
        'repo',
      ])

      // then
      expect(actual).toEqual({
        status: 'ok',
        data: join(store.sessionsDir, 'group', 'subgroup', 'repo', 'one'),
      })
      expect(existsSync(store.sessionsDir)).toBe(false)
    } finally {
      clean()
    }
  },
)

for (const operation of ['resolve', 'registered', 'taken'] as const) {
  test(
    [
      'given a registered nested run',
      `when performing the ${operation} lookup`,
      'it should report the registered placement',
    ].join(', '),
    () => {
      // given
      const { store, clean } = scratch()
      try {
        const claimed = claimRunDirectory(store)('one', [
          'group',
          'subgroup',
          'repo',
        ])
        if (claimed.status === 'error') throw claimed.error
        const lookup = {
          resolve: () => resolveRunDirectory(store)('one'),
          registered: () => registeredRepositoryPath(store)('one'),
          taken: () => runIdTaken(store)('one'),
        }
        const expected = {
          resolve: claimed.data,
          registered: ['group', 'subgroup', 'repo'],
          taken: true,
        }

        // when
        const actual = lookup[operation]()

        // then
        expect(actual).toEqual(expected[operation])
      } finally {
        clean()
      }
    },
  )
}

test(
  [
    'given a registered run',
    'when claiming it with another repository path',
    'it should keep the original directory',
  ].join(', '),
  () => {
    // given
    const { store, clean } = scratch()
    try {
      const first = claimRunDirectory(store)('one', [
        'group',
        'subgroup',
        'repo',
      ])
      if (first.status === 'error') throw first.error

      // when
      const actual = claimRunDirectory(store)('one', ['other', 'repo'])

      // then
      expect(actual).toEqual(first)
    } finally {
      clean()
    }
  },
)

test(
  [
    'given a registered nested run',
    'when forgetting its directory',
    'it should remove only the run registration',
  ].join(', '),
  () => {
    // given
    const { store, clean } = scratch()
    try {
      const claimed = claimRunDirectory(store)('one', [
        'group',
        'subgroup',
        'repo',
      ])
      if (claimed.status === 'error') throw claimed.error

      // when
      forgetRunDirectory(store)('one')
      const taken = runIdTaken(store)('one')
      const db = openDatabase(store.dbPath)
      const groups = db
        .query('SELECT path FROM repository_directories ORDER BY path')
        .all()
      db.close()

      // then
      expect(taken).toBe(false)
      expect(groups).toEqual([
        { path: 'group' },
        { path: 'group/subgroup' },
        { path: 'group/subgroup/repo' },
      ])
    } finally {
      clean()
    }
  },
)

test(
  [
    'given an existing flat run directory',
    'when checking whether its id is taken',
    'it should reserve that id',
  ].join(', '),
  () => {
    // given
    const { store, clean } = scratch()
    try {
      mkdirSync(join(store.sessionsDir, 'flat'), { recursive: true })

      // when
      const actual = runIdTaken(store)('flat')

      // then
      expect(actual).toBe(true)
    } finally {
      clean()
    }
  },
)

test(
  [
    'given an existing flat run directory',
    'when claiming it with a repository path',
    'it should join the flat directory without registering it',
  ].join(', '),
  () => {
    // given
    const { store, clean } = scratch()
    try {
      const flat = join(store.sessionsDir, 'flat')
      mkdirSync(flat, { recursive: true })

      // when
      const actual = claimRunDirectory(store)('flat', ['other', 'repo'])
      const registered = registeredRepositoryPath(store)('flat')

      // then
      expect(actual).toEqual({ status: 'ok', data: flat })
      expect(registered).toBeUndefined()
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
