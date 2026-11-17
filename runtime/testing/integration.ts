/**
 * Integration tests create a git repository, run just, start bun on a runtime
 * entry point or fixture, or wait on a wall-clock timer for at least one second.
 * Real pi model discovery is also guarded: host extensions can run git worktree.
 * Tests guarded by SKIP_INTEGRATION are skipped unless RUN_INTEGRATION_TESTS=true.
 * mise run test:agent and mise run test:raw set it; mise run test does not.
 * The former test:ci and check:stdout scripts no longer exist.
 * A scoped run whose tests all report skip has verified nothing. Run it with:
 * RUN_INTEGRATION_TESTS=true CLAUDECODE=1 bun test <path>
 */
export const SKIP_INTEGRATION = process.env.RUN_INTEGRATION_TESTS !== 'true'
