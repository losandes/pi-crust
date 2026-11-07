#!/usr/bin/env bun
/**
 * Blocking checker for the parameter-immutability rule in
 * adr/typescript/functional-conventions.md ("Immutability").
 *
 * Exported functions must not accept a parameter a caller can watch them mutate.
 * Object and array parameters are readonly at the top level — `Readonly<T>`,
 * `readonly T[]`, or a type whose properties are declared readonly.
 *
 * This cannot be a Biome plugin. Deciding whether `TThing` is already readonly
 * means resolving the type, following the alias, and inspecting its property
 * modifiers. GritQL sees syntax only, so it would have to guess from the shape of
 * the annotation and would be wrong on every alias.
 *
 * Usage:
 *   bun check-immutable-params.ts                # files changed vs git HEAD
 *   bun check-immutable-params.ts <path>...      # specific files or directories
 *   bun check-immutable-params.ts --all          # every source file in the repo
 *
 * Exit codes: 0 = clean, 1 = violations found, 2 = usage/environment error
 */

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { existsSync, statSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

// The workspace root is derived from this script's own location, not from
// `git rev-parse --show-toplevel` — this workspace is nested inside a much larger
// repository whose toplevel would pull in unrelated codebases.
const SCRIPT_DIR = dirname(new URL(import.meta.url).pathname)
/*
 * The project being worked in, not a path derived from this file's location:
 * this skill lives outside every repository it serves.
 */
const REPO_ROOT = (() => {
  const override = process.env.MY_WORKSPACE
  if (override !== undefined && override !== '') return resolve(override)
  const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' })
  const root = top.status === 0 ? top.stdout.trim() : ''
  return root === '' ? process.cwd() : root
})()

/*
 * No workspace-manifest requirement. The original refused to run unless it
 * found pnpm-workspace.yaml, which proved the root was the monorepo it was
 * written for. Here the root is whatever project is being worked in, and a
 * project using another package manager still has TypeScript worth checking.
 */

// Parameters named for an error are exempt. A caught error is not ours to make
// readonly — the shapes come from libraries and the runtime, and annotating them
// as immutable is a claim we cannot keep.
const EXEMPT_NAME = /^(err|error)/i

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.git',
  '.next',
  // Agent tooling, not application source. These directories hold no package of
  // their own, so without excluding them the checker reports its own scripts as
  // belonging to a package with no tsconfig every time one is edited.
  '.claude',
  '.pi',
  '.github',
])

const TOOLING_PATH = /\/\.(claude|pi|github)\//

const isCheckable = (file: string): boolean =>
  /\.tsx?$/.test(file) &&
  !/\.d\.ts$/.test(file) &&
  !/\.(test|spec)\.tsx?$/.test(file) &&
  !/fixture/.test(file) &&
  // SKIP_DIRS only prunes directory traversal. Changed-file and explicit-path
  // modes never walk, so the exclusion has to be repeated here.
  !TOOLING_PATH.test(file)

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return SKIP_DIRS.has(entry.name) ? [] : walk(join(dir, entry.name))
    }
    const full = join(dir, entry.name)
    return isCheckable(full) ? [full] : []
  })

const changedFiles = (): string[] => {
  // This workspace is nested inside a much larger repository, so the git root is
  // an ancestor of REPO_ROOT rather than equal to it. Paths are resolved against
  // that outer root and then filtered back down to this workspace.
  //
  // Not inside a repository at all is an environment error, not a clean run, so
  // it exits 2 rather than falling through to "no files to check" and 0.
  let gitRoot: string
  try {
    gitRoot = execFileSync('git', ['-C', REPO_ROOT, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    console.error(
      'error: not inside a git repository; pass paths explicitly or use --all',
    )
    process.exit(2)
  }

  // Every command runs from the git root, so every path it prints is relative to
  // the same base. That is not automatic: `git diff` reports from the repository
  // root wherever it is run, while `ls-files` reports from the working directory.
  // Running the two from different directories and joining both onto the git root
  // silently dropped every untracked file — which is to say, every new file, the
  // ones a conventions checker most needs to see.
  const git = (args: string[]): string[] => {
    try {
      return execFileSync('git', ['-C', gitRoot, ...args], {
        encoding: 'utf8',
      })
        .split('\n')
        .filter(Boolean)
    } catch {
      return []
    }
  }

  return [
    ...git(['diff', '--name-only', '--diff-filter=ACMR', 'HEAD']),
    ...git(['diff', '--name-only', '--diff-filter=ACMR', '--cached']),
    ...git(['ls-files', '--others', '--exclude-standard']),
  ]
    .map((p) => join(gitRoot, p))
    .filter((p) => p.startsWith(`${REPO_ROOT}/`) && isCheckable(p) && existsSync(p))
}

/** Nearest ancestor holding both a package.json and a tsconfig.json. */
const packageRootFor = (file: string): string | null => {
  let dir = dirname(file)
  while (dir.startsWith(REPO_ROOT)) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'tsconfig.json'))) {
      return dir
    }
    dir = dirname(dir)
  }
  return null
}

// ---------------------------------------------------------------------------

const argv = process.argv.slice(2)
const scope = argv.includes('--all')
  ? 'all source files'
  : argv.length > 0
    ? 'given paths'
    : 'changed vs git'

const targets: string[] = argv.includes('--all')
  ? walk(REPO_ROOT)
  : argv.length > 0
    ? argv.flatMap((p) => {
        const abs = resolve(p)
        if (!existsSync(abs)) return []
        return statSync(abs).isDirectory() ? walk(abs) : isCheckable(abs) ? [abs] : []
      })
    : changedFiles()

if (targets.length === 0) {
  console.log(`check-immutable-params: no files to check (${scope})`)
  process.exit(0)
}

// Grouped in one pass. The earlier version rebuilt each package's array on every
// insertion, which is quadratic in files per package; accumulating with push
// would fix the cost but is the collection-building case the conventions record
// rejects outright. Map.groupBy is both.
const grouped = Map.groupBy(targets, packageRootFor)
const orphans = grouped.get(null) ?? []
const byPackage = new Map(
  [...grouped].filter((entry): entry is [string, string[]] => entry[0] !== null),
)

let violations = 0
let checked = 0

for (const [pkgRoot, files] of byPackage) {
  const require = createRequire(join(pkgRoot, 'package.json'))
  let ts: typeof import('typescript')
  try {
    ts = require('typescript')
  } catch {
    console.error(
      `error: ${relative(REPO_ROOT, pkgRoot)} has a tsconfig.json but no typescript dependency`,
    )
    process.exit(2)
  }

  /*
   * The compiler has to be the PROJECT'S, because it type-checks the
   * project's code against the project's settings. Outside the monorepo this
   * was written in, it may simply not be installed — and the import then
   * resolves to something unusable rather than throwing, so the first use
   * crashed with `undefined is not an object` instead of saying what was
   * wrong.
   */
  if (ts?.sys === undefined) {
    console.error(
      `error: no usable TypeScript compiler for ${relative(REPO_ROOT, pkgRoot)}; install typescript in that package`,
    )
    process.exit(2)
  }

  const configPath = join(pkgRoot, 'tsconfig.json')
  const raw = ts.readConfigFile(configPath, ts.sys.readFile)
  const parsed = ts.parseJsonConfigFileContent(raw.config ?? {}, ts.sys, pkgRoot)

  const program = ts.createProgram(files, {
    ...parsed.options,
    noEmit: true,
    skipLibCheck: true,
  })
  const checker = program.getTypeChecker()

  /**
   * Shallow immutability: nothing the callee assigns can be seen by the caller.
   * Deep immutability is deliberately not required — we do not control the types
   * that arrive from other people's libraries, and demanding it there produces
   * suppressions rather than safety.
   */
  const isShallowReadonly = (type: import('typescript').Type, depth = 0): boolean => {
    // Recursion bound for self-referential types (a tree node whose children
    // are the same type), which would otherwise never terminate.
    //
    // It bails out as READONLY, so a type too deep to resolve is reported as
    // clean. That direction is deliberate: the opposite would emit findings
    // no reader can act on — the parameter is already annotated, and the only
    // way to silence it is a suppression. A checker that cannot be satisfied
    // teaches people to ignore it.
    //
    // Depth is bounded by nesting of unions and intersections, not by the
    // size of the type, so 4 covers the shapes that appear here with room to
    // spare. Raising it costs time on pathological types and catches nothing
    // real; lowering it starts passing types that could have been resolved.
    if (depth > 4) return true

    if (type.isUnionOrIntersection()) {
      return type.types.every((t) => isShallowReadonly(t, depth + 1))
    }

    const harmless =
      ts.TypeFlags.StringLike |
      ts.TypeFlags.NumberLike |
      ts.TypeFlags.BooleanLike |
      ts.TypeFlags.BigIntLike |
      ts.TypeFlags.ESSymbolLike |
      ts.TypeFlags.Void |
      ts.TypeFlags.Undefined |
      ts.TypeFlags.Null |
      ts.TypeFlags.Never |
      ts.TypeFlags.Any |
      ts.TypeFlags.Unknown |
      ts.TypeFlags.TypeParameter
    if (type.flags & harmless) return true

    // Known limit: this trusts the symbol's name. A library declaring its own
    // type called ReadonlyArray would be accepted as readonly without being so.
    // Distinguishing them means comparing against the global ReadonlyArray type,
    // which is not reachable through the public checker API.
    if (checker.isArrayType(type)) {
      return type.getSymbol()?.getName() === 'ReadonlyArray'
    }
    if (checker.isTupleType(type)) {
      const target = (type as import('typescript').TupleTypeReference).target
      return target.readonly === true
    }

    const props = checker.getPropertiesOfType(type)
    // A type with no properties but call signatures is a function — nothing to mutate.
    if (props.length === 0) return true

    return props.every(isReadonlyProperty)
  }

  const isReadonlyProperty = (prop: import('typescript').Symbol): boolean => {
    const decls = prop.getDeclarations() ?? []
    if (decls.length === 0) return true
    return decls.some(
      (d) => (ts.getCombinedModifierFlags(d) & ts.ModifierFlags.Readonly) !== 0,
    )
  }

  // A member of a union that holds nothing a caller could mutate. Literal types
  // cover `null`, `'a'`, `1`, and `true`; the keywords cover the rest.
  const VALUELESS_KINDS = new Set<import('typescript').SyntaxKind>([
    ts.SyntaxKind.StringKeyword,
    ts.SyntaxKind.NumberKeyword,
    ts.SyntaxKind.BooleanKeyword,
    ts.SyntaxKind.BigIntKeyword,
    ts.SyntaxKind.SymbolKeyword,
    ts.SyntaxKind.UndefinedKeyword,
    ts.SyntaxKind.VoidKeyword,
    ts.SyntaxKind.NeverKeyword,
    ts.SyntaxKind.NullKeyword,
  ])

  const isValuelessMember = (node: import('typescript').TypeNode): boolean =>
    VALUELESS_KINDS.has(node.kind) || ts.isLiteralTypeNode(node)

  const READONLY_WRAPPERS = new Set([
    'Readonly',
    'ReadonlyArray',
    'ReadonlyMap',
    'ReadonlySet',
    'DeepReadonly',
  ])

  /**
   * `Readonly<T>` is a mapped type, and its property symbols still point at the
   * declarations of the type it wrapped — which carry no readonly modifier. So
   * inspecting resolved properties reports every `Readonly<T>` as mutable, and
   * TypeScript exposes no public API for the modifier a mapped type applies.
   *
   * Reading the annotation answers it. The alias is followed because the idiom
   * in this codebase is `type TThing = Readonly<{...}>` used by name, where the
   * wrapper is a declaration away from the parameter.
   */
  const isReadonlyAnnotation = (
    node: import('typescript').TypeNode | undefined,
    depth = 0,
  ): boolean => {
    // Bounds the walk through aliases and wrappers — `Readonly<Partial<T>>`
    // via a named alias is three hops before the annotation is reached.
    //
    // Bails out as NOT readonly, the opposite direction to isShallowReadonly
    // above, and for the same reason: here a false negative is the safe
    // failure. Missing a readonly annotation buried seven levels deep costs
    // one unreported violation; inventing one would mark a mutable parameter
    // clean, which is the failure this checker exists to prevent.
    //
    // 6 is chosen to clear the deepest idiom in use (an alias to a wrapper
    // around a generic) with margin. Lowering it silently stops resolving
    // real annotations; there is no benefit in raising it.
    if (!node || depth > 6) return false

    // `readonly T[]` and `readonly [A, B]`
    if (ts.isTypeOperatorNode(node) && node.operator === ts.SyntaxKind.ReadonlyKeyword) {
      return true
    }
    if (ts.isParenthesizedTypeNode(node)) return isReadonlyAnnotation(node.type, depth + 1)

    if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node)) {
      // Members with no interior are dropped before the test. A caller cannot
      // watch `undefined` be mutated, but it is neither a type reference nor a
      // type operator, so requiring every member to read as readonly failed on
      // the whole union and fell through to the resolved type — which, per the
      // note above, reports every `Readonly<T>` as mutable. `Readonly<TFoo> |
      // undefined` was therefore reported, and the annotation was right.
      const carriers = node.types.filter((t) => !isValuelessMember(t))
      return carriers.every((t) => isReadonlyAnnotation(t, depth + 1))
    }

    if (!ts.isTypeReferenceNode(node)) return false

    const name = ts.isIdentifier(node.typeName)
      ? node.typeName.text
      : node.typeName.right.text
    if (READONLY_WRAPPERS.has(name)) return true

    // Follow a type alias to whatever it was declared as.
    const symbol = checker.getSymbolAtLocation(node.typeName)
    const aliased =
      symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
    const decl = aliased?.getDeclarations()?.[0]
    return decl && ts.isTypeAliasDeclaration(decl)
      ? isReadonlyAnnotation(decl.type, depth + 1)
      : false
  }

  /** Parameters of the function, and of any arrow it returns directly (currying). */
  const parametersOf = (
    fn: import('typescript').SignatureDeclaration,
  ): import('typescript').ParameterDeclaration[] => {
    const own = [...fn.parameters]
    const body = 'body' in fn ? fn.body : undefined
    if (body && (ts.isArrowFunction(body) || ts.isFunctionExpression(body))) {
      return [...own, ...parametersOf(body)]
    }
    return own
  }

  const isExportedStatement = (stmt: import('typescript').Statement): boolean =>
    (ts.getCombinedModifierFlags(stmt as import('typescript').Declaration) &
      ts.ModifierFlags.Export) !==
    0

  /**
   * The outermost function of each exported statement, and no deeper. Nested
   * helpers are not part of the package's surface, and recursing into them
   * double-counts a curried function's parameters — `parametersOf` already
   * follows the returned arrows.
   */
  const exportedFunctions = (
    source: import('typescript').SourceFile,
  ): import('typescript').SignatureDeclaration[] =>
    source.statements.filter(isExportedStatement).flatMap((stmt) => {
      if (ts.isFunctionDeclaration(stmt)) return [stmt]
      if (!ts.isVariableStatement(stmt)) return []
      return stmt.declarationList.declarations.flatMap((decl) => {
        const init = decl.initializer
        return init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
          ? [init]
          : []
      })
    })

  for (const file of files) {
    const source = program.getSourceFile(file)
    if (!source) continue
    checked += 1
    const rel = relative(REPO_ROOT, file)

    for (const fn of exportedFunctions(source)) {
      for (const param of parametersOf(fn)) {
        if (!param.type) continue // ignoreInferredTypes — nothing was claimed
        if (!ts.isIdentifier(param.name)) continue
        if (EXEMPT_NAME.test(param.name.text)) continue

        if (isReadonlyAnnotation(param.type)) continue

        const type = checker.getTypeAtLocation(param.type)
        if (isShallowReadonly(type)) continue

        const { line } = source.getLineAndCharacterOfPosition(param.getStart())
        console.log(`  ${rel}:${line + 1}`)
        console.log(
          `      [immutable-params] parameter '${param.name.text}' is mutable; ` +
            `a caller cannot see what this function assigns to it`,
        )
        violations += 1
      }
    }
  }
}

for (const file of orphans) {
  console.log(`  ${relative(REPO_ROOT, file)}`)
  console.log('      [no-tsconfig] skipped; the owning package has no tsconfig.json')
}

console.log()
console.log(
  `check-immutable-params: scope=${scope} checked=${checked} ` +
    `skipped_no_tsconfig=${orphans.length} violations=${violations}`,
)

if (violations > 0) {
  console.log()
  console.log('Rule: adr/typescript/functional-conventions.md, "Immutability"')
  process.exit(1)
}

console.log('All checked files pass.')
