#!/usr/bin/env bun
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { TSettlement } from '../lib/typedefs'
import { PACKAGE_ROOT, type TEnv } from '../runtime/lib/system'

export type TReleasePlan = Readonly<{
  version: string
  branch: string
  distTag: string
  archive: string
  minNode: string
}>
const numeric = '(0|[1-9][0-9]*)'
const identifier = '(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)'
const versionPattern = new RegExp(
  `^v?${numeric}\\.${numeric}\\.${numeric}(?:-${identifier}(?:\\.${identifier})*)?$`,
)

export const planRelease = (
  release: Readonly<{ tag: string; target: string; enginesNode: string }>,
): TSettlement<TReleasePlan> => {
  const { tag, target, enginesNode } = release
  const message = versionPattern.test(tag)
    ? /^[a-fA-F0-9]{40}$/.test(target)
      ? `release-plan: release targets commit ${target}, not a branch`
      : !/^[A-Za-z][A-Za-z0-9._-]*$/.test(target) ||
          target === 'latest' ||
          /^[vV][0-9]/.test(target)
        ? `release-plan: branch "${target}" cannot be an npm dist-tag`
        : /^>=(\d+\.\d+\.\d+)$/.test(enginesNode)
          ? undefined
          : `release-plan: engines.node "${enginesNode}" is not a minimum version`
    : `release-plan: tag "${tag}" is not a version`
  if (message !== undefined)
    return { status: 'error', error: new Error(message) }
  const version = tag.replace(/^v/, '')
  return {
    status: 'ok',
    data: {
      version,
      branch: target,
      distTag: target === 'main' ? 'latest' : target,
      archive: `polyn-pi-crust-${version}.tgz`,
      minNode: enginesNode.slice(2),
    },
  }
}
export const releaseEnvLines = (plan: TReleasePlan): readonly string[] => [
  `RELEASE_VERSION=${plan.version}`,
  `RELEASE_BRANCH=${plan.branch}`,
  `RELEASE_DIST_TAG=${plan.distTag}`,
  `RELEASE_ARCHIVE=${plan.archive}`,
  `RELEASE_MIN_NODE=${plan.minNode}`,
]
export type TReleasePlanDeps = Readonly<{
  env: TEnv
  enginesNode: () => string
  out: (line: string) => unknown
  err: (line: string) => unknown
}>
export const main = (deps: TReleasePlanDeps) => (): number => {
  const plan = planRelease({
    tag: deps.env.RELEASE_TAG ?? '',
    target: deps.env.RELEASE_TARGET ?? '',
    enginesNode: deps.enginesNode(),
  })
  if (plan.status === 'error') {
    deps.err(plan.error.message)
    return 1
  }
  releaseEnvLines(plan.data).forEach((line) => {
    deps.out(line)
  })
  return 0
}
export const releasePlanDeps: TReleasePlanDeps = {
  env: process.env,
  enginesNode: () =>
    z
      .object({
        engines: z
          .object({ node: z.string().default('') })
          .default({ node: '' }),
      })
      .parse(
        JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')),
      ).engines.node,
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
}
if (import.meta.main) process.exitCode = main(releasePlanDeps)()
