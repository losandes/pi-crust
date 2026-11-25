import { expect, test } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { SKIP_INTEGRATION } from '../../../runtime/testing/integration'
import {
  restoreTerminal,
  silenceTerminal,
} from '../../../runtime/testing/terminal-capture'
import { fixtureDbPath, insertSession } from './trace-db-fixture.test'

test.skipIf(SKIP_INTEGRATION)(
  [
    'given an isolated visualizer with a trace and stub runtime',
    'when its read and write routes receive valid and refused requests',
    'it should serve the trace and dispatch only authorized commands',
  ].join(', '),
  async () => {
    // given
    const dbPath = fixtureDbPath()
    const root = dirname(dbPath)
    const home = join(root, 'home')
    const runtime = join(root, 'package/runtime')
    const session = join(root, 'sessions/run')
    const handoff = join(session, 'context_handoff')
    mkdirSync(join(runtime, 'commands'), { recursive: true })
    mkdirSync(handoff, { recursive: true })
    for (const path of [
      'cli.ts',
      'commands/run.ts',
      'commands/steer.ts',
      'commands/ask.ts',
      'commands/amend.ts',
    ])
      writeFileSync(
        join(runtime, path),
        'process.stdout.write("stub ran\\n")\n',
      )
    const invocation = join(session, 'invocation.json')
    writeFileSync(
      invocation,
      JSON.stringify({
        argv: [process.execPath, join(runtime, 'commands/run.ts'), 'request'],
        cwd: root,
      }),
    )
    insertSession(dbPath, {
      run_id: 'run',
      status: 'fail',
      workspace_root: root,
      started_at: '2025-01-01T00:00:00Z',
    })
    insertSession(dbPath, {
      run_id: 'orphan',
      status: 'fail',
      workspace_root: join(root, 'missing'),
    })
    const patch = {
      CRUST_DB: dbPath,
      CRUST_BE_PORT: '0',
      CRUST_TOKEN: 'fixture-token',
      HOME: home,
      CRUST_MACHINE_CONFIG: join(home, 'machine'),
      CRUST_HOME: dirname(runtime),
      CRUST_DATA_DIR: root,
    }
    const previous = Object.fromEntries(
      Object.keys(patch).map((key) => [key, process.env[key]]),
    )
    // biome-ignore lint/plugin/no-object-mutation: these are the isolated server's external inputs, restored in finally
    Object.assign(process.env, patch)
    silenceTerminal()
    const { server } = await import('./index.ts')
    const origin = `http://localhost:${server.port}`
    const request = async (
      path: string,
      expected: number,
      method = 'GET',
      body?: unknown,
      token = true,
    ) => {
      const response = await fetch(`${origin}${path}`, {
        method,
        headers: {
          ...(token ? { 'x-crust-token': 'fixture-token' } : {}),
          'content-type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      const text = await response.text()
      expect({
        path,
        status: response.status,
        text: response.status === expected ? '' : text,
      }).toEqual({ path, status: expected, text: '' })
      return text
    }
    try {
      // when
      for (const path of [
        '/api/health',
        '/api/workspaces',
        '/api/themes',
        '/api/sessions',
        '/api/sessions?limit=bad&include_archived=true',
        '/api/sessions/run',
        '/api/sessions/run/events?after=0&limit=1',
        '/api/sessions/run/envelopes',
        '/api/sessions/run/gates',
        '/api/sessions/run/handoff',
        '/api/sessions/run/decision-request',
        '/api/sessions/run/agents/scout/prompts',
        '/',
      ])
        await request(path, 200)
      const workspaces = JSON.parse(await request('/api/workspaces', 200))
      await request(
        `/api/sessions?workspace=${encodeURIComponent(workspaces[0].label)}`,
        200,
      )
      await request('/api/sessions?workspace=absent', 404)
      for (const suffix of [
        '',
        '/events',
        '/envelopes',
        '/gates',
        '/handoff',
        '/decision-request',
        '/agents/scout/prompts',
      ])
        await request(`/api/sessions/absent${suffix}`, 404)
      await request('/api/nope', 404)
      for (const suffix of [
        '/handoff',
        '/decision-request',
        '/handoff/a',
        '/agents/scout/prompts',
      ])
        await request(`/api/sessions/%2F${suffix}`, 400)
      await request('/api/sessions/run/agents/%2F/prompts', 400)
      writeFileSync(
        join(handoff, 'decision-request.md'),
        '# Decision\nProceed?\n',
      )
      mkdirSync(join(handoff, 'nested'))
      writeFileSync(join(handoff, 'nested/note.md'), '# Note\ntext\n')
      mkdirSync(join(session, 'scout/prompts'), { recursive: true })
      writeFileSync(join(session, 'scout/prompts/system.md'), 'system prompt')
      expect(
        JSON.parse(await request('/api/sessions/run/decision-request', 200))
          .markdown,
      ).toContain('Proceed?')
      expect(
        JSON.parse(await request('/api/sessions/run/handoff', 200)),
      ).toHaveLength(2)
      expect(
        await request('/api/sessions/run/handoff/nested/note.md', 200),
      ).toContain('# Note')
      await request('/api/sessions/run/handoff/missing', 404)
      await request('/api/sessions/absent/handoff/file', 404)
      await request('/api/sessions/run/handoff/%2e%2e%2foutside', 400)
      expect(
        JSON.parse(await request('/api/sessions/run/agents/scout/prompts', 200))
          .system,
      ).toBe('system prompt')
      for (const [path, valid] of [
        ['/messages', { kind: 'steer', message: 'continue', from: 'tester' }],
        ['/decision', { action: 'approve', from: 'tester' }],
        ['/resume', { note: 'continue' }],
        ['/archive', {}],
        ['/activities/scout/consult', { question: 'why?' }],
        ['/activities/scout/steer', { target: 'overwrite', note: 'again' }],
      ] as const) {
        await request(`/api/sessions/run${path}`, 401, 'POST', valid, false)
        await request(`/api/sessions/%2F${path}`, 400, 'POST', valid)
        await request(`/api/sessions/absent${path}`, 404, 'POST', valid)
        await request(`/api/sessions/run${path}`, 200, 'POST', valid)
      }
      await request('/api/sessions/run/messages', 400, 'POST', {})
      await request('/api/sessions/run/messages', 400, 'POST', {
        kind: 'follow_up',
        message: '',
      })
      await request('/api/sessions/run/messages', 200, 'POST', {
        kind: 'abort',
      })
      await request('/api/sessions/run/decision', 400, 'POST', {})
      await request('/api/sessions/run/decision', 400, 'POST', {
        action: 'answer',
      })
      await request('/api/sessions/run/decision', 200, 'POST', {
        action: 'answer',
        text: 'Proceed.',
      })
      await request('/api/sessions/run/resume', 400, 'POST', { note: 2 })
      await request('/api/sessions/run/archive', 200, 'POST', {
        archived: false,
      })
      await request(
        '/api/sessions/run/activities/scout/consult',
        400,
        'POST',
        {},
      )
      await request('/api/sessions/run/activities/scout/consult', 200, 'POST', {
        mode: 'amend',
        question: 'fix it',
      })
      await request('/api/sessions/run/activities/scout/steer', 400, 'POST', {})
      await request('/api/sessions/run/activities/scout/steer', 400, 'POST', {
        target: 'overwrite',
      })
      await request('/api/sessions/run/activities/scout/steer', 200, 'POST', {
        target: 'branch',
        note: 'branch',
      })
      for (const suffix of ['consult', 'steer']) {
        await request(
          `/api/sessions/orphan/activities/scout/${suffix}`,
          503,
          'POST',
          suffix === 'consult'
            ? { question: 'why?' }
            : { target: 'overwrite', note: 'again' },
        )
        await request(
          `/api/sessions/run/activities/%2F/${suffix}`,
          400,
          'POST',
          {},
        )
      }
      await request('/api/runs', 401, 'POST', {}, false)
      await request('/api/runs', 400, 'POST', {})
      await request('/api/runs', 400, 'POST', { workspace_root: root })
      await request('/api/runs', 400, 'POST', {
        workspace_root: root,
        lifecycle: 'sdlc',
        prompt: 'work',
        workspace: 'missing',
      })
      await request('/api/runs', 200, 'POST', {
        workspace_root: root,
        lifecycle: 'sdlc',
        prompt: 'work',
        args: ['--run-id', 'fixture', 3],
      })
      for (const [path, status] of [
        ['/api/sessions/run/messages', 400],
        ['/api/sessions/run/decision', 400],
        ['/api/sessions/run/resume', 200],
        ['/api/runs', 400],
        ['/api/sessions/run/activities/scout/consult', 400],
        ['/api/sessions/run/activities/scout/steer', 400],
        ['/api/sessions/run/archive', 200],
      ] as const) {
        const malformed = await fetch(`${origin}${path}`, {
          method: 'POST',
          headers: {
            'x-crust-token': 'fixture-token',
            'content-type': 'application/json',
          },
          body: '{',
        })
        expect(malformed.status).toBe(status)
        await malformed.text()
      }
      rmSync(join(handoff, 'decision-request.md'))
      mkdirSync(join(handoff, 'decision-request.md'))
      await request('/api/sessions/run/decision-request', 500)
      rmSync(join(handoff, 'decision-request.md'), { recursive: true })
      rmSync(invocation)
      await request('/api/sessions/run/resume', 503, 'POST', {})
      await request('/api/sessions/run/decision', 503, 'POST', {
        action: 'reject',
        text: 'no',
      })
      // biome-ignore lint/plugin/no-object-mutation: exercise the explicit runtime refusal without launching a real command
      process.env.CRUST_HOME = join(root, 'missing-package')
      await request('/api/runs', 503, 'POST', {
        workspace_root: root,
        lifecycle: 'sdlc',
        prompt: 'work',
      })
      await request('/api/sessions/run/activities/scout/consult', 503, 'POST', {
        question: 'why?',
      })
      await request('/api/sessions/run/activities/scout/steer', 503, 'POST', {
        target: 'overwrite',
        note: 'again',
      })
      // then
      expect(readFileSync(join(session, 'inbox.jsonl'), 'utf8')).toContain(
        'continue',
      )
    } finally {
      await server.stop()
      restoreTerminal()
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]
        else {
          // biome-ignore lint/plugin: restore the external environment owned by this fixture
          process.env[key] = value
        }
      }
      rmSync(root, { recursive: true, force: true })
    }
  },
  30000,
)
