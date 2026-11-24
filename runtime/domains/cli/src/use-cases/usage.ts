import { errorMessage } from '../../../../../lib/typedefs'
import { EXIT } from '../../../../lib/contracts'

export const LIST_USAGE =
  `usage: crust list [--config <path>]\n` +
  'env: CRUST_CONFIG overrides the config path; the flag still wins.'

export const PRUNE_USAGE =
  'usage: crust prune <14d|36h> [--yes] [--db <path>] [--tree <path>]\n' +
  'env: CRUST_DB overrides the db path; --db still wins.\n' +
  '--tree restricts pruning to runs whose workspace_root matches exactly; ' +
  'omitted, the whole store is pruned (1.8.2, 1.8.3).'

export const JOIN_USAGE = [
  'usage: crust join <run-id> <activity>',
  'env: CRUST_DB and CRUST_CONFIG override the paths; PI_PATH names the pi binary.',
].join('\n')

export const reportUsageError =
  (usage: string) =>
  (error: unknown): number => {
    process.stderr.write(`${errorMessage(error)}\n${usage}\n`)
    return EXIT.USAGE
  }
