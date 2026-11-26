#!/usr/bin/env bun
/** Argument validation, process-row parsing, interface selection and archive, invocation, page and process decisions live in package-faults.ts; this boundary installs with npm and drives a second Node and Chromium. */
import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { createConnection, createServer } from 'node:net'
import { networkInterfaces, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { RECIPE_DOCS } from '../runtime/domains/cli'
import { createTracer } from '../runtime/domains/trace'
import { PACKAGE_ROOT } from '../runtime/lib/system'
import { installFaults } from './install-faults'
import {
  archiveFaults,
  externalIPv4,
  invocationFaults,
  invocations,
  pageFaults,
  parseArgs,
  parseProcessRows,
  processFaults,
  runtimeFaults,
  setupFiles,
  type TProcessRow,
} from './package-faults'

const say = (line: string): void => {
  process.stdout.write(`check-package: ${line}\n`)
}
const warn = (line: string): void => {
  process.stderr.write(`check-package: ${line}\n`)
}
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms))
const filesUnder = (dir: string): readonly string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? filesUnder(join(dir, entry.name)).map((path) => `${entry.name}/${path}`)
      : [entry.name],
  )
const alive = (pid: number): boolean => {
  // biome-ignore lint/plugin/no-intermediate-try-catch: OS probe boundary, ESRCH means the process is gone
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (z.object({ code: z.literal('ESRCH') }).safeParse(error).success)
      return false
    throw error
  }
}
const signal = (pid: number, value: NodeJS.Signals): void => {
  // biome-ignore lint/plugin/no-intermediate-try-catch: OS signal boundary, an already-ended group requires no signal
  try {
    process.kill(-pid, value)
  } catch (error) {
    if (z.object({ code: z.literal('ESRCH') }).safeParse(error).success) return
    throw error
  }
}
const freePort = async (): Promise<number> => {
  const server = createServer()
  await new Promise<void>((done, reject) => {
    server.once('error', reject)
    server.listen(0, '0.0.0.0', done)
  })
  const address = server.address()
  if (address === null || typeof address === 'string')
    throw new Error('no free port')
  await new Promise<void>((done) => server.close(() => done()))
  return address.port
}
const connects = (host: string, port: number): Promise<boolean> =>
  new Promise((done) => {
    const socket = createConnection({ host, port })
    const end = (connected: boolean) => {
      socket.destroy()
      done(connected)
    }
    socket.once('connect', () => end(true))
    socket.once('error', () => end(false))
    socket.setTimeout(500, () => end(false))
  })
const localUrl = (url: string): string =>
  url.replace('://localhost:', '://127.0.0.1:')
const fetchPage = async (
  url: string,
): Promise<Readonly<{ status: number; contentType: string }>> => {
  // biome-ignore lint/plugin/no-intermediate-try-catch: HTTP probe boundary reports failed connections as a failed response
  try {
    const response = await fetch(localUrl(url), {
      signal: AbortSignal.timeout(3000),
    })
    await response.arrayBuffer()
    return {
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
    }
  } catch (error) {
    warn(`HTTP ${url}: ${String(error)}`)
    return { status: 0, contentType: '' }
  }
}

const main = async (argv: readonly string[]): Promise<number> => {
  const args = parseArgs(argv)
  if (args.status === 'error') {
    warn(args.error.message)
    return 2
  }
  const archive = resolve(args.data.archive)
  const nodeBin = resolve(args.data.nodeBin)
  // biome-ignore lint/plugin/no-intermediate-try-catch: command usage boundary reports inaccessible inputs with status 2
  try {
    accessSync(archive, constants.R_OK)
    accessSync(join(nodeBin, 'node'), constants.X_OK)
  } catch (error) {
    warn(
      `archive must be readable and --node-bin must hold node: ${String(error)}`,
    )
    return 2
  }
  const scratch = realpathSync(
    mkdtempSync(join(tmpdir(), 'crust-check-package-')),
  )
  const prefix = join(scratch, 'prefix')
  const home = join(scratch, 'home')
  const repo = join(scratch, 'repo')
  const groups = new Set<number>()
  const faults = new Set<string>()
  const add = (items: readonly string[]): void => {
    items.forEach((item) => {
      faults.add(item)
      warn(item)
    })
  }
  const env = {
    PATH: `${nodeBin}:${prefix}/bin:/usr/bin:/bin`,
    HOME: home,
    npm_config_prefix: prefix,
  }
  const runEnv = {
    ...env,
    CRUST_DATA_DIR: join(scratch, 'data'),
    CRUST_DB: join(scratch, 'data/crust.db'),
    PI_PATH: join(scratch, 'no-pi'),
  }
  const command =
    (name: string, extra: Readonly<Record<string, string>> = {}) =>
    (params: readonly string[], cwd = scratch) =>
      spawnSync(name, [...params], {
        cwd,
        env: { ...env, ...extra },
        encoding: 'utf8',
        timeout: 60000,
        maxBuffer: 16 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
  const crust = join(prefix, 'bin/crust')
  const start = (
    params: readonly string[],
    extra: Readonly<Record<string, string>> = {},
  ) => {
    const child = spawn(crust, [...params], {
      cwd: repo,
      env: { ...runEnv, ...extra },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    if (child.pid !== undefined) groups.add(child.pid)
    const output: string[] = []
    // biome-ignore lint/plugin/no-array-mutation: process-boundary stream collector, owned by this child handle
    child.stdout?.on('data', (bytes) => output.push(String(bytes)))
    // biome-ignore lint/plugin/no-array-mutation: process-boundary stream collector, owned by this child handle
    child.stderr?.on('data', (bytes) => output.push(String(bytes)))
    child.on('error', (error) => {
      add([`crust ${params.join(' ')}: ${error.message}`])
    })
    return { child, output: () => output.join('') }
  }
  const end = async (child: ChildProcess): Promise<void> => {
    if (child.pid === undefined) return
    signal(child.pid, 'SIGINT')
    const deadline = Date.now() + 5000
    while (alive(-child.pid) && Date.now() < deadline) await sleep(50)
    if (alive(-child.pid)) {
      add(['crust observe: process group survived SIGINT for 5 seconds'])
      signal(child.pid, 'SIGKILL')
    }
  }
  const invoke = async (
    params: readonly string[],
    extra: Readonly<Record<string, string>>,
  ) => {
    const started = start(params, extra)
    const timedOut = { value: false }
    const timer = setTimeout(() => {
      timedOut.value = true
      if (started.child.pid !== undefined) signal(started.child.pid, 'SIGKILL')
    }, 60000)
    try {
      await new Promise<void>((done) => {
        started.child.once('close', () => done())
      })
      return {
        status: started.child.exitCode,
        timedOut: timedOut.value,
        output: started.output(),
      }
    } finally {
      clearTimeout(timer)
    }
  }
  // Browser handles belong to this cleanup boundary, including failed probes.
  const browsers: { close: () => Promise<void> }[] = []
  const cleanup = async (): Promise<void> => {
    groups.forEach((pid) => {
      signal(pid, 'SIGKILL')
    })
    const closed = await Promise.allSettled(
      browsers.map((browser) => browser.close()),
    )
    closed
      .filter((result) => result.status === 'rejected')
      .forEach((result) => {
        warn(`browser cleanup: ${String(result.reason)}`)
      })
    rmSync(scratch, { recursive: true, force: true })
  }
  const interrupt = (): void => {
    void cleanup().finally(() => process.exit(130))
  }
  const terminate = (): void => {
    void cleanup().finally(() => process.exit(143))
  }
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', terminate)
  // biome-ignore lint/plugin/no-intermediate-try-catch: top-level archive-check boundary reports unexpected faults and owns all cleanup
  try {
    const bePort = await freePort()
    const fePort = await freePort()
    const observe = async (flags: readonly string[]) => {
      const started = start(['observe', ...flags], {
        CRUST_BE_PORT: String(bePort),
        CRUST_FE_PORT: String(fePort),
      })
      const deadline = Date.now() + 10000
      while (
        !started.output().includes('[crust] visualizer ui') &&
        started.child.exitCode === null &&
        started.child.signalCode === null &&
        Date.now() < deadline
      )
        await sleep(50)
      const url = /\[crust\] visualizer ui\s+(http:\/\/\S+)/.exec(
        started.output(),
      )?.[1]
      if (url === undefined) {
        const label = ['crust', 'observe', ...flags].join(' ')
        add([`${label}: no UI address within 10 seconds`])
        say(`SKIPPED probes of ${label}, it did not start`)
      }
      return { ...started, url }
    }
    const processRows = (): readonly TProcessRow[] =>
      parseProcessRows(
        command('ps', runEnv)(['-A', '-o', 'pid=,ppid=,args=']).stdout,
      )
    const external = externalIPv4(networkInterfaces())
    mkdirSync(home, { recursive: true })
    mkdirSync(prefix, { recursive: true })
    const listing = command('tar')(['-tzf', archive])
    const manifestFile = command('tar')([
      '-xOzf',
      archive,
      'package/package.json',
    ])
    if (listing.status !== 0 || manifestFile.status !== 0) {
      add(['cannot read package archive'])
      return 1
    }
    const record = z.record(z.string(), z.unknown())
    const manifest = record.parse(JSON.parse(manifestFile.stdout))
    const root = z
      .object({
        version: z.string(),
        description: z.string(),
        license: z.string(),
        engines: z.object({ node: z.string() }),
        dependencies: record,
      })
      .parse(
        JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')),
      )
    const programs = [
      ...new Set([
        'runtime/cli.ts',
        ...RECIPE_DOCS.map((doc) => doc.run.script),
        'apps/visualizer/server/index.ts',
        'runtime/extensions/path-policy.ts',
      ]),
    ].map((path) => path.replace(/\.ts$/, '.js'))
    add(
      archiveFaults({
        paths: listing.stdout
          .trim()
          .split('\n')
          .filter((path) => !path.endsWith('/'))
          .map((path) => path.replace(/^package\//, '')),
        manifest,
        programs,
        expected: {
          name: '@polyn/pi-crust',
          description: root.description,
          license: root.license,
          type: 'module',
          bin: { crust: 'runtime/cli.js' },
          engines: { node: root.engines.node },
          dependencies: root.dependencies,
          publishConfig: { access: 'public' },
        },
      }),
    )
    if (faults.size > 0) return 1
    const node = command('node')(['--version'])
    const bun = env.PATH.split(':')
      .map((dir) => join(dir, 'bun'))
      .find((path) => existsSync(path))
    add(
      runtimeFaults({
        node: node.stdout.trim(),
        engines: z.object({ node: z.string() }).parse(manifest.engines).node,
        bun,
      }),
    )
    if (node.status !== 0) add(['node --version failed'])
    if (faults.size > 0) return 1
    say(`node ${node.stdout.trim()}, bun unreachable`)
    const installed = command('npm')(['install', '-g', archive])
    if (installed.status !== 0 || !existsSync(crust)) {
      add([`npm install failed: ${installed.stderr || installed.stdout}`])
      return 1
    }
    // biome-ignore lint/plugin/no-intermediate-try-catch: disposable fixture setup boundary distinguishes environment failures (exit 2) from package faults
    try {
      mkdirSync(repo)
      if (command('git')(['init'], repo).status !== 0)
        throw new Error('git init failed')
      const tracer = createTracer(
        join(scratch, 'data/crust.db'),
        join(scratch, 'data/events.jsonl'),
      )
      try {
        tracer.sessionStart(
          'chkpkg01',
          'check-package',
          'check',
          'check-package fixture',
        )
        tracer.sessionWorkspace('chkpkg01', repo, 'main', '', repo)
        tracer.sessionFinish('chkpkg01', true)
      } finally {
        tracer.close()
      }
      writeFileSync(join(scratch, 'broken.toml'), '= broken\n')
    } catch (error) {
      warn(`cannot create fixture: ${String(error)}`)
      return 2
    }
    const init = await invoke(['init'], {})
    if (init.status !== 0)
      add([`crust init exited ${init.status}: ${init.output}`])
    const config = join(repo, 'pi-crust.toml')
    add(
      installFaults({
        files: setupFiles(filesUnder(repo)),
        installed: existsSync(config) ? readFileSync(config, 'utf8') : '',
        template: readFileSync(
          join(PACKAGE_ROOT, 'templates/pi-crust.toml'),
          'utf8',
        ),
      }),
    )
    for (const invocation of invocations({
      runId: 'chkpkg01',
      brokenConfig: join(scratch, 'broken.toml'),
    })) {
      const result = await invoke(invocation.argv, invocation.env)
      const found = invocationFaults(invocation, result, prefix)
      add(found)
      if (found.length > 0) warn(result.output)
    }
    const first = await observe([])
    const seen = processRows()
    if (first.url !== undefined) {
      const page = await fetchPage(first.url)
      if (page.status !== 200 || !page.contentType.includes('text/html'))
        add(['crust observe: UI did not return HTML with HTTP 200'])
      if (
        (await fetchPage(`http://127.0.0.1:${bePort}/api/health`)).status !==
        200
      )
        add(['crust observe: API health failed'])
      // biome-ignore lint/plugin/no-intermediate-try-catch: browser probe boundary records a failed probe without skipping shutdown or binding checks
      try {
        const require = createRequire(
          join(PACKAGE_ROOT, 'apps/visualizer/package.json'),
        )
        const { chromium } = await import(require.resolve('playwright'))
        if (existsSync(chromium.executablePath())) {
          const browser = await chromium.launch({ env: runEnv, timeout: 10000 })
          // biome-ignore lint/plugin/no-array-mutation: the cleanup boundary owns these external browser handles
          browsers.push(browser)
          const page = await browser.newPage()
          const responses: {
            url: string
            resourceType: string
            status: number
          }[] = []
          const pageErrors: string[] = []
          page.on(
            'response',
            (response: {
              url: () => string
              status: () => number
              request: () => { resourceType: () => string }
            }) => {
              // biome-ignore lint/plugin/no-array-mutation: this boundary owns the asynchronous browser observation stream
              responses.push({
                url: response.url(),
                resourceType: response.request().resourceType(),
                status: response.status(),
              })
            },
          )
          // biome-ignore lint/plugin/no-array-mutation: stream observations are collected at the browser boundary
          page.on('pageerror', (error: Error) => pageErrors.push(error.message))
          const runVisible = await page
            .goto(localUrl(first.url), { timeout: 10000 })
            .then(() =>
              page
                .getByText('chkpkg01', { exact: true })
                .first()
                .waitFor({ state: 'visible', timeout: 10000 }),
            )
            .then(
              () => true,
              () => false,
            )
          add(pageFaults({ runVisible, responses, pageErrors }))
          await browser.close()
        } else
          add([
            'the browser check needs Chromium: run "bunx playwright install chromium" from apps/visualizer',
          ])
      } catch (error) {
        add([`browser probe failed: ${String(error)}`])
      }
      if (first.child.pid !== undefined)
        add(processFaults({ rows: seen, root: first.child.pid, prefix }))
      if (external !== undefined && (await connects(external, fePort)))
        add([
          'crust observe: default listener is reachable on the external interface',
        ])
    }
    await end(first.child)
    if (first.url === undefined) {
      say('SKIPPED restart, the first crust observe did not start')
    } else {
      const descendants = seen.filter((row) =>
        row.command.includes(`${prefix}/`),
      )
      if (
        (await connects('127.0.0.1', fePort)) ||
        (await connects('127.0.0.1', bePort)) ||
        descendants.some((row) => alive(row.pid))
      )
        add(['crust observe: a process or listener survived SIGINT'])
      const second = await observe([])
      try {
        if (
          second.url !== undefined &&
          (second.url !== first.url ||
            (await fetchPage(second.url)).status !== 200)
        )
          add(['crust observe: restart did not serve the same address'])
      } finally {
        await end(second.child)
      }
    }
    if (external === undefined)
      say('SKIPPED network binding checks, no external IPv4 interface')
    else {
      for (const flags of [['--host'], ['--host', external]]) {
        const session = await observe(flags)
        try {
          if (session.url !== undefined) {
            if (
              !session.output().includes(`http://${external}:${fePort}`) ||
              (await fetchPage(`http://${external}:${fePort}`)).status !== 200
            )
              add([`crust observe ${flags.join(' ')}: external UI unavailable`])
            if (flags.length === 2 && (await connects('127.0.0.1', fePort)))
              add([
                'crust observe --host <address>: loopback listener should be refused',
              ])
          }
        } finally {
          await end(session.child)
        }
      }
    }
    if (faults.size === 0)
      say('archive, commands, browser, shutdown, restart and bindings passed')
    return faults.size === 0 ? 0 : 1
  } catch (error) {
    warn(String(error))
    return 1
  } finally {
    process.off('SIGINT', interrupt)
    process.off('SIGTERM', terminate)
    await cleanup()
  }
}
if (import.meta.main) process.exitCode = await main(process.argv.slice(2))
