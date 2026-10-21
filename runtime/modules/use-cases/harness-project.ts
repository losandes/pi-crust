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
    baseUrl: '.',
    paths: {
      '@earendil-works/*': [join(hostModules, '@earendil-works', '*')],
      typebox: [join(hostModules, 'typebox')],
      'typebox/*': [join(hostModules, 'typebox', '*')],
    },
  },
})
