import { expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'

/*
 * gh-72 reorganizes apps/visualizer/src from a flat components/+lib/+theme
 * shape into domains/, layouts/, lib/<package>/ and pages/. The plan's own
 * "Proves it" lines for this are shell greps and `ls` checks run by hand
 * once, during the move — they verify nothing afterwards. These tests read
 * the same source the greps read, so a later change that reopens a flat
 * src/components, a deep cross-domain import, or a page that starts
 * fetching fails a test rather than only a human rereading the plan.
 *
 * Source-level requirements covered (see the gh-72 plan, "## 1. Requirements"):
 * 1.1.1, 1.1.2, 1.1.3, 1.1.4, 1.1.5, 1.2.1, 1.2.4, 1.2.5, 1.2.6, 1.3.1, 1.5.3.
 */

const SRC = join(import.meta.dir)

const DOMAIN_LAYERS = ['_components', 'io', 'state', 'typedefs', 'usecases']

/** The dependency graph the gh-72 plan's section 2.2 declares, domain → the
 * other domains it may import. `run-controls` → `decisions` is the one
 * documented exception (RunControls.tsx calls `sendDecision` directly); see
 * the gh-72 build report's "Unresolved" section. */
const ALLOWED_DOMAIN_EDGES: Record<string, readonly string[]> = {
  sessions: ['activity-runs', 'decisions', 'events', 'handoff', 'run-controls'],
  'activity-runs': [
    'decisions',
    'events',
    'handoff',
    'narration',
    'run-controls',
  ],
  narration: ['decisions', 'events'],
  handoff: ['events'],
  decisions: [],
  'run-controls': ['decisions'],
  events: [],
  themes: [],
}

const sourceFiles = (dir: string): readonly string[] => {
  if (!existsSync(dir)) return []
  const entries = readdirSync(dir, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .filter((entry) => /\.(ts|tsx)$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
}

const importTargets = (source: string, pattern: RegExp): string[] => {
  const matches = [...source.matchAll(pattern)]
  return matches.map((match) => match[1] as string)
}

test(
  [
    'given apps/visualizer/src',
    'when its top-level entries are listed',
    'it should contain exactly domains, layouts, lib and pages as directories, with no components or theme directory',
  ].join(', '),
  () => {
    // given
    const entries = readdirSync(SRC, { withFileTypes: true })

    // when
    const directories = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .toSorted()

    // then — 1.1.1
    expect(directories).toEqual(['domains', 'layouts', 'lib', 'pages'])
    expect(existsSync(join(SRC, 'components'))).toBe(false)
    expect(existsSync(join(SRC, 'theme'))).toBe(false)
  },
)

test(
  [
    'given apps/visualizer/src',
    'when the non-test files directly under it are listed',
    'it should contain exactly App.tsx, main.tsx, style.css and vite-env.d.ts',
  ].join(', '),
  () => {
    // given — this file itself (architecture.test.ts) is excluded: 1.1.2
    // names the production files allowed directly under src, and this repo's
    // convention co-locates a test beside the thing it verifies, which for a
    // whole-tree structure test is the tree root itself.
    const entries = readdirSync(SRC, { withFileTypes: true })

    // when
    const files = entries
      .filter((entry) => entry.isFile())
      .filter((entry) => !/\.test\.tsx?$/.test(entry.name))
      .map((entry) => entry.name)
      .toSorted()

    // then — 1.1.2
    expect(files).toEqual(['App.tsx', 'main.tsx', 'style.css', 'vite-env.d.ts'])
  },
)

const STYLESHEET = /\.(css|scss|sass|less|styl|stylus|pcss|postcss)$/i

/** Every stylesheet below `root`, as sorted paths relative to it. */
const stylesheetsUnder = (root: string): readonly string[] =>
  readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => !entry.isDirectory())
    .filter((entry) => STYLESHEET.test(entry.name))
    .map((entry) => relative(root, join(entry.parentPath, entry.name)))
    .toSorted()

test(
  [
    'given apps/visualizer/src',
    'when stylesheets at every directory depth are listed',
    'it should contain only style.css and domains/themes/src/tokens.css',
  ].join(', '),
  () => {
    // given
    const root = SRC

    // when
    const actual = stylesheetsUnder(root)

    // then
    expect(actual).toEqual(['domains/themes/src/tokens.css', 'style.css'])
  },
)

test(
  [
    'given a source tree with a module stylesheet and a plain stylesheet beside a component',
    'when stylesheets at every directory depth are listed',
    'it should list both beside the two shared stylesheets',
  ].join(', '),
  () => {
    // given
    const root = mkdtempSync(join(tmpdir(), 'visualizer-stylesheets-'))
    const files = [
      'domains/sessions/src/_components/SessionCard.module.css',
      'domains/sessions/src/_components/SessionCard.tsx',
      'domains/sessions/src/_components/session-card.css',
      'domains/themes/src/tokens.css',
      'style.css',
    ]
    try {
      for (const file of files) {
        mkdirSync(dirname(join(root, file)), { recursive: true })
        writeFileSync(join(root, file), '')
      }

      // when
      const actual = stylesheetsUnder(root)

      // then
      expect(actual).toEqual(files.filter((file) => file.endsWith('.css')))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  },
)

test(
  [
    'given src/lib',
    'when it is listed',
    'it should contain no loose .ts/.tsx files, only package directories',
  ].join(', '),
  () => {
    // given
    const entries = readdirSync(join(SRC, 'lib'), { withFileTypes: true })

    // when
    const looseFiles = entries.filter((entry) => entry.isFile())

    // then — 1.1.1
    expect(looseFiles).toEqual([])
  },
)

test(
  [
    'given each package under src/lib',
    'when its contents are read',
    'it should have an index.ts and a src/ directory holding its code',
  ].join(', '),
  () => {
    // given
    const packages = readdirSync(join(SRC, 'lib'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)

    for (const pkg of packages) {
      // when
      const root = join(SRC, 'lib', pkg)

      // then — 1.1.3
      expect(existsSync(join(root, 'index.ts'))).toBe(true)
      expect(statSync(join(root, 'src')).isDirectory()).toBe(true)
    }
  },
)

test(
  [
    'given lib/_components',
    'when its src/ is read',
    'it should group components by atomic design stage under atoms and molecules',
  ].join(', '),
  () => {
    // given
    const componentsSrc = join(SRC, 'lib', '_components', 'src')

    // when
    const subdirs = readdirSync(componentsSrc, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .toSorted()

    // then — 1.1.3
    expect(subdirs).toEqual(['atoms', 'molecules'])
  },
)

test(
  [
    'given src/domains',
    'when it is listed',
    'it should contain exactly the eight named domains',
  ].join(', '),
  () => {
    // given
    const entries = readdirSync(join(SRC, 'domains'), { withFileTypes: true })

    // when
    const domains = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .toSorted()

    // then — 1.1.5
    expect(domains).toEqual([
      'activity-runs',
      'decisions',
      'events',
      'handoff',
      'narration',
      'run-controls',
      'sessions',
      'themes',
    ])
  },
)

test(
  [
    'given each domain under src/domains',
    'when its contents are read',
    'it should have an index.ts, a src/ directory with only the five layer subdirectories, and no package.json',
  ].join(', '),
  () => {
    // given
    const domains = readdirSync(join(SRC, 'domains'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)

    for (const domain of domains) {
      const root = join(SRC, 'domains', domain)

      // when
      const indexExists = existsSync(join(root, 'index.ts'))
      const srcDirs = readdirSync(join(root, 'src'), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
      const hasPackageJson = existsSync(join(root, 'package.json'))

      // then — 1.1.4
      expect(indexExists).toBe(true)
      for (const dir of srcDirs) {
        expect(DOMAIN_LAYERS).toContain(dir)
      }
      expect(hasPackageJson).toBe(false)
    }
  },
)

test(
  [
    'given every .ts/.tsx file under apps/visualizer/src',
    'when its imports are read',
    'it should never import a path inside another domain\u2019s src (only @/domains/<name> itself)',
  ].join(', '),
  () => {
    // given
    const files = sourceFiles(SRC)
    const deepImportPattern = /from ['"]@\/domains\/[a-z-]+\/[^'"]*['"]/

    // when
    const offenders = files.filter((file) =>
      deepImportPattern.test(readFileSync(file, 'utf8')),
    )

    // then — 1.2.1
    expect(offenders).toEqual([])
  },
)

test(
  [
    'given every .ts/.tsx file under src/lib',
    'when its imports are read',
    'it should never import from @/domains',
  ].join(', '),
  () => {
    // given
    const files = sourceFiles(join(SRC, 'lib'))

    // when
    const offenders = files.filter((file) =>
      readFileSync(file, 'utf8').includes('@/domains'),
    )

    // then — 1.2.4
    expect(offenders).toEqual([])
  },
)

test(
  [
    'given every lib package other than lib/_components',
    'when its imports are read',
    'it should never import from lib/_components',
  ].join(', '),
  () => {
    // given
    const packages = readdirSync(join(SRC, 'lib'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => name !== '_components')

    // when
    const offenders = packages.flatMap((pkg) =>
      sourceFiles(join(SRC, 'lib', pkg)).filter((file) =>
        readFileSync(file, 'utf8').includes('@/lib/_components'),
      ),
    )

    // then — 1.2.4
    expect(offenders).toEqual([])
  },
)

test(
  [
    'given each domain\u2019s imports of other domains',
    'when the @/domains/<name> edges are collected',
    'it should match the acyclic dependency graph the plan declares, with no unlisted edge',
  ].join(', '),
  () => {
    // given
    const domains = Object.keys(ALLOWED_DOMAIN_EDGES)

    // when
    const unlistedEdges = domains.flatMap((domain) => {
      const files = sourceFiles(join(SRC, 'domains', domain, 'src'))
      const targets = new Set(
        files.flatMap((file) =>
          importTargets(
            readFileSync(file, 'utf8'),
            /from ['"]@\/domains\/([a-z-]+)['"]/g,
          ),
        ),
      )
      const allowed = ALLOWED_DOMAIN_EDGES[domain] ?? []
      return [...targets]
        .filter((target) => !allowed.includes(target))
        .map((target) => `${domain} -> ${target}`)
    })

    // then — 1.2.5
    expect(unlistedEdges).toEqual([])
  },
)

test(
  [
    'given domains/decisions, domains/events and domains/themes',
    'when their @/domains edges are collected',
    'it should contain none, since they sit at the bottom of the dependency graph',
  ].join(', '),
  () => {
    for (const domain of ['decisions', 'events', 'themes']) {
      // given
      const files = sourceFiles(join(SRC, 'domains', domain, 'src'))

      // when
      const targets = files.flatMap((file) =>
        importTargets(
          readFileSync(file, 'utf8'),
          /from ['"]@\/domains\/([a-z-]+)['"]/g,
        ),
      )

      // then — 1.2.5, 2.2's table
      expect(targets).toEqual([])
    }
  },
)

test(
  [
    'given src/pages/index.tsx and src/pages/[run-id]/index.tsx',
    'when their source is read',
    'it should contain no fetch, no React state/effect hooks, and no api-client import',
  ].join(', '),
  () => {
    // given
    const indexPage = readFileSync(join(SRC, 'pages', 'index.tsx'), 'utf8')
    const runPage = readFileSync(
      join(SRC, 'pages', '[run-id]', 'index.tsx'),
      'utf8',
    )

    // when
    const forbidden = /fetch|useState|useEffect|useSyncExternalStore|api-client/

    // then — 1.3.1
    expect(forbidden.test(indexPage)).toBe(false)
    expect(forbidden.test(runPage)).toBe(false)
  },
)

test(
  [
    'given src/App.tsx',
    'when its source is read',
    'it should contain only the route read and the switch between the two pages, with no chrome markup',
  ].join(', '),
  () => {
    // given
    const appSource = readFileSync(join(SRC, 'App.tsx'), 'utf8')

    // when (nothing to transform; these assert against the raw source)

    // then — 1.3.2: the chrome markers that used to live in App.tsx moved to
    // layouts/default-layout.tsx and must not reappear here
    expect(appSource).toContain('useRoute')
    expect(appSource).not.toMatch(/breadcrumb/i)
    expect(appSource).not.toMatch(/ThemePicker/)
  },
)

test(
  [
    'given apps/visualizer/package.json',
    'when its dependencies are read',
    'it should not list zustand, since state/ stays a directory, not a new library',
  ].join(', '),
  () => {
    // given
    const pkg = JSON.parse(
      readFileSync(join(SRC, '..', 'package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }

    // when
    const names = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ]

    // then — 1.5.3
    expect(names).not.toContain('zustand')
  },
)

test(
  [
    'given visualizer tests and the browser testing helpers',
    'when their static imports are inspected',
    'it should load Playwright and Vite only through dynamic imports',
  ].join(', '),
  () => {
    // given
    const files = [
      ...sourceFiles(SRC),
      ...sourceFiles(join(SRC, '..', 'server')),
    ].filter(
      (file) =>
        /\.test\.tsx?$/.test(file) ||
        file.startsWith(join(SRC, 'lib', 'testing')),
    )
    const staticValueImport =
      /^\s*import\s+(?!type\b)(?:[^'"]*?\s+from\s*)?['"](?:playwright|vite)['"]/m

    // when
    const offenders = files.filter((file) =>
      staticValueImport.test(readFileSync(file, 'utf8')),
    )

    // then
    expect(offenders).toEqual([])
  },
)

test(
  [
    'given tests importing a browser, harness server or production CSS builder',
    'when their test declarations are inspected',
    'it should gate every test on browserTestsEnabled',
  ].join(', '),
  () => {
    // given
    const files = [
      ...sourceFiles(SRC),
      ...sourceFiles(join(SRC, '..', 'server')),
    ].filter((file) => /\.test\.tsx?$/.test(file))
    const gatedDeclaration = ['test', '.skipIf(!browserTestsEnabled)('].join('')
    const browserImport =
      /import\s*\{[^}]*\b(?:launchChromium|startHarnessServer|buildProductionCss)\b[^}]*\}\s*from\s*['"][^'"]+['"]/m

    // when
    const offenders = files.flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      if (!browserImport.test(source)) return []
      return [...source.matchAll(/^\s*(?:test|it)(?=\s*[.(])[^\n]*/gm)]
        .filter((match) => !match[0].trimStart().startsWith(gatedDeclaration))
        .map((match) => `${file}: ${match[0].trim()}`)
    })

    // then
    expect(offenders).toEqual([])
  },
)
