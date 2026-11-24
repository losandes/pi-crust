import { expect, spyOn, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTracer } from '../domains/trace'
import { SHIPPED_CONFIG_DIR } from '../testing/shipped-layer'
import {
  restoreTerminal,
  silenceTerminal,
  terminalOutput,
} from '../testing/terminal-capture'
import { main } from './please'

test(
  [
    'given a configured please wizard',
    'when a new run is cancelled',
    'it should return without starting a process',
  ].join(', '),
  async () => {
    // given
    const root = mkdtempSync(join(tmpdir(), 'crust-please-new-'))
    const path = join(root, 'config.toml')
    writeFileSync(path, '')
    const previous = process.env.CRUST_PACKAGE_CONFIG
    // biome-ignore lint/plugin/no-object-mutation: scope the configuration boundary for the asynchronous wizard
    process.env.CRUST_PACKAGE_CONFIG = SHIPPED_CONFIG_DIR
    silenceTerminal()
    try {
      // when
      const result = await main({
        env: { CRUST_CONFIG: path },
        cwd: root,
        cli: '/absent/cli.ts',
        askOne: () => Promise.resolve(undefined),
        askText: () => Promise.resolve(undefined),
        askOrder: () => Promise.resolve(undefined),
        askMenuChoice: () =>
          Promise.resolve({ values: undefined, reorder: false }),
        copy: () => Promise.resolve({ copied: false, how: 'fixture' }),
        run: () => {
          throw new Error('must not start')
        },
      })()
      // then
      expect(result).toBe(130)
    } finally {
      if (previous === undefined) delete process.env.CRUST_PACKAGE_CONFIG
      // biome-ignore lint/plugin/no-object-mutation: restore the scoped configuration environment
      else process.env.CRUST_PACKAGE_CONFIG = previous
      restoreTerminal()
      rmSync(root, { recursive: true, force: true })
    }
  },
)

test(
  [
    'given a wizard whose input fails',
    'when the command handles the failure',
    'it should print the diagnostic and return failure',
  ].join(', '),
  async () => {
    // given
    const root = mkdtempSync(join(tmpdir(), 'crust-please-error-'))
    const db = join(root, 'crust.db')
    const tracer = createTracer(db, join(root, 'events.jsonl'))
    tracer.sessionStart('waiting', 'tester', 'test')
    tracer.sessionWaiting('waiting')
    tracer.close()
    let diagnostic = ''
    const stderr = spyOn(process.stderr, 'write').mockImplementation((text) => {
      diagnostic = `${diagnostic}${String(text)}`
      return true
    })
    try {
      // when
      const result = await main({
        env: { CRUST_CONFIG: join(root, 'missing.toml'), CRUST_DB: db },
        cwd: root,
        cli: '/absent/cli.ts',
        askOne: () => Promise.reject(new Error('input failed')),
        askText: () => Promise.resolve(undefined),
        askOrder: () => Promise.resolve(undefined),
        askMenuChoice: () =>
          Promise.resolve({ values: undefined, reorder: false }),
        copy: () => Promise.resolve({ copied: false, how: 'fixture' }),
        run: () => {
          throw new Error('must not start')
        },
      })()
      // then
      expect(result).toBe(1)
      expect(diagnostic).toBe('Error: input failed\n')
    } finally {
      stderr.mockRestore()
      rmSync(root, { recursive: true, force: true })
    }
  },
)

test(
  [
    'given the shipped lifecycles and a new run request',
    'when the builder is told to run',
    'it should dispatch the displayed prompt and lifecycle and return the process status',
  ].join(', '),
  async () => {
    // given
    const root = mkdtempSync(join(tmpdir(), 'crust-please-dispatch-'))
    const path = join(root, 'config.toml')
    writeFileSync(path, `[defaults]\ndata_dir = ${JSON.stringify(root)}\n`)
    const previous = process.env.CRUST_PACKAGE_CONFIG
    // biome-ignore lint/plugin/no-object-mutation: scope the configuration boundary for the asynchronous wizard
    process.env.CRUST_PACKAGE_CONFIG = SHIPPED_CONFIG_DIR
    let answers = ['50', 'yes', '', 'no', 'run']
    let calls: unknown[] = []
    const deps: Parameters<typeof main>[0] = {
      env: { CRUST_CONFIG: path },
      cwd: root,
      cli: '/pkg/runtime/cli.ts',
      askOne: () => {
        const answer = answers.at(0)
        answers = answers.slice(1)
        return Promise.resolve(answer)
      },
      askText: async () => 'fix the login bug',
      askOrder: async () => undefined,
      askMenuChoice: async () => ({ values: ['@bugfix'], reorder: false }),
      copy: async () => ({ copied: false, how: 'fixture' }),
      run: (run) => {
        calls = [...calls, run]
        return 7
      },
    }
    silenceTerminal()
    try {
      // when
      const actual = await main(deps)()
      // then
      expect(terminalOutput()).toContain(
        'crust run "fix the login bug" --lifecycle bugfix',
      )
      expect(calls).toEqual([
        {
          script: deps.cli,
          args: ['run', 'fix the login bug', '--lifecycle', 'bugfix'],
          cwd: deps.cwd,
          env: deps.env,
        },
      ])
      expect(actual).toBe(7)
    } finally {
      if (previous === undefined) delete process.env.CRUST_PACKAGE_CONFIG
      // biome-ignore lint/plugin/no-object-mutation: restore the scoped configuration environment
      else process.env.CRUST_PACKAGE_CONFIG = previous
      restoreTerminal()
      rmSync(root, { recursive: true, force: true })
    }
  },
)

for (const mode of [
  'cancel',
  'print',
  'no-copy',
  'run',
  'cancel-plan',
] as const) {
  test(
    [
      `given please ${mode}`,
      `when answered`,
      `it should print or run only with consent`,
    ].join(', '),
    async () => {
      // given
      const root = mkdtempSync(join(tmpdir(), 'crust-please-'))
      const db = join(root, 'crust.db')
      const tracer = createTracer(db, join(root, 'events.jsonl'))
      tracer.sessionStart('waiting', 'tester', 'test')
      tracer.sessionWaiting('waiting')
      tracer.close()
      let answers =
        mode === 'cancel'
          ? [undefined]
          : mode === 'cancel-plan'
            ? ['waiting', undefined]
            : [
                'waiting',
                'approve',
                ['print', 'no-copy'].includes(mode) ? 'print' : 'run',
              ]
      let copied: string[] = []
      let calls: unknown[] = []
      const deps: Parameters<typeof main>[0] = {
        env: { CRUST_CONFIG: join(root, 'missing.toml'), CRUST_DB: db },
        cwd: root,
        cli: '/pkg/runtime/cli.ts',
        askOne: () => {
          const answer = answers.at(0)
          answers = answers.slice(1)
          return Promise.resolve(answer)
        },
        askText: async () => undefined,
        askOrder: async () => undefined,
        askMenuChoice: async () => ({ values: undefined, reorder: false }),
        copy: (line) => {
          copied = [...copied, line]
          return Promise.resolve({ copied: mode !== 'no-copy', how: 'fixture' })
        },
        run: (run) => {
          calls = [...calls, run]
          return 7
        },
      }
      silenceTerminal()
      try {
        // when
        const result = await main(deps)()
        // then
        expect(result).toBe(
          mode.startsWith('cancel') ? 130 : mode === 'run' ? 7 : 0,
        )
        expect(calls).toHaveLength(mode === 'run' ? 1 : 0)
        if (mode === 'run')
          expect(calls[0]).toEqual({
            script: deps.cli,
            args: ['approve', 'waiting'],
            cwd: root,
            env: deps.env,
          })
        if (mode === 'print') {
          expect(copied).toEqual(['crust approve waiting'])
          expect(terminalOutput()).toContain('crust approve waiting')
        }
      } finally {
        restoreTerminal()
        rmSync(root, { recursive: true, force: true })
      }
    },
  )
}
