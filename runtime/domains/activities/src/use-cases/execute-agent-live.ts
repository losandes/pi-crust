/**
 * Excluded from coverage: the live `TAgentPorts` adapters — a real agent
 * spawn, real git, and a real filesystem write, with no decision logic of
 * their own. No `bun test` process can exercise a real coding-agent spawn,
 * so this module holds only that boundary — `liveAgent` moved here from
 * `execute-agent.ts`, unchanged, so the decision logic that calls it
 * (prompt composition, the JSON-repair loop, path-policy arming, permission
 * enforcement) stays covered there. See COVERAGE-AGENT-PORTS.md.
 */

import { render, run, savePrompt } from '../../../agents'
import {
  changedFiles,
  isRepo,
  rev,
  snapshotTree,
  untrackedFiles,
} from '../../../workspace'
import type { TAgentPorts } from './execute-agent'

/** The real adapters: git.ts, prompt-files.ts, pi-agent.ts, working-tree.ts. */
export const liveAgent: TAgentPorts = {
  run: (request, hooks) => run(request, hooks),
  changed: () => changedFiles(),
  untracked: () => untrackedFiles(),
  render: (templatePath, variables) => render(templatePath, variables),
  savePrompt: (directory, name, content) =>
    savePrompt(directory, name, content),
  snapshot: (roots) => snapshotTree(roots),
  rev: (ref) => (isRepo() ? rev(ref) : ''),
}
