/**
 * The TypeScript project that checks `harness-engineering/` against a pi
 * host, as data.
 *
 * The extensions in that directory import `@earendil-works/*` and `typebox`
 * from the host that loads them. Those are not dependencies of this
 * repository and declaring them would pin us to a version no agent here
 * necessarily runs — npm's latest was 1.3.0 while this machine ran 1.1.0 —
 * so the host's own module tree is the target instead, discovered at check
 * time by `data/pi-host.ts`.
 *
 * Pure, so the mapping can be tested without a pi install or a compiler.
 * `scripts/typecheck-harness.ts` writes it out and runs tsc over it.
 */

import { join } from 'node:path'

/**
 * A project rooted at `runtime/`, inheriting that directory's tsconfig.
 *
 * `extends` is relative because the generated file is written beside the
 * config it extends: `types: ["bun"]` and the rest resolve from the file
 * that declares them, and a copy in a temp directory resolves none of them.
 */
export const harnessProject = (
  hostModules: string,
): Readonly<Record<string, unknown>> => ({
  extends: './tsconfig.json',
  include: ['harness-engineering'],
  exclude: ['node_modules', 'data'],
  compilerOptions: {
    /*
     * Inherited as `true`, and wrong here.
     *
     * `composite` exists so the repository root can REFERENCE `runtime/`, and
     * it requires a project to list every file it pulls in. This project
     * includes `harness-engineering` alone, while those extensions import
     * into `domains/` and `lib/` — so each reached file is reported as
     * `TS6307: not listed within the file list of project`, fifteen of them
     * the day a `domains/workspace/src/data/roots.ts` joined the graph.
     *
     * Listing the reachable set would be an inventory of the import graph,
     * maintained by hand, that goes stale on the next import. Nothing
     * references this project — it is generated, run once and deleted — so
     * the constraint buys nothing and is switched off rather than satisfied.
     * Scope is unchanged: tsc still checks `harness-engineering` and still
     * type-checks everything those files reach.
     */
    composite: false,
    baseUrl: '.',
    paths: {
      '@earendil-works/*': [join(hostModules, '@earendil-works', '*')],
      typebox: [join(hostModules, 'typebox')],
      'typebox/*': [join(hostModules, 'typebox', '*')],
    },
  },
})
