import {
  safeParseSettlement,
  type TSettlement,
} from '../../../../../lib/typedefs'
import { lifecycleUsage, parseCli } from './parse-cli'

/**
 * The arguments that pin a lifecycle command to its Lifecycle, or why the
 * typed arguments are refused.
 */
export const lifecycleCommandArgs = (
  command: string,
  lifecycle: string,
  typed: readonly string[],
): TSettlement<readonly string[]> => {
  const parsed = safeParseSettlement(() =>
    parseCli(typed, command, lifecycleUsage(command, lifecycle)),
  )
  if (parsed.status === 'error') return parsed
  if (
    parsed.data.lifecycle !== undefined &&
    parsed.data.lifecycle !== lifecycle
  )
    return {
      status: 'error',
      error: new Error(
        `crust ${command}: --lifecycle ${parsed.data.lifecycle} conflicts with this command, which always runs the ${lifecycle} Lifecycle. Run \`crust run "<prompt>" --lifecycle ${parsed.data.lifecycle}\` instead.`,
      ),
    }
  if (parsed.data.activities !== undefined)
    return {
      status: 'error',
      error: new Error(
        `crust ${command}: a lifecycle and a list of Activities cannot both be given. This command always runs the ${lifecycle} Lifecycle; got --activities ${parsed.data.activities}. Run \`crust run "<prompt>" --activities ${parsed.data.activities}\` instead.`,
      ),
    }
  return { status: 'ok', data: ['--lifecycle', lifecycle] }
}
