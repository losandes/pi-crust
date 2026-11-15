import { THINKING_LEVELS } from '../../../../lib/contracts'

export type TModelOverride = Readonly<{
  name: string
  model: string | undefined
  thinking: string | undefined
}>

type TModelOverrides = Readonly<{
  overrides: readonly TModelOverride[]
  warnings: readonly string[]
}>

export const parseModelOverrides = (value: string): TModelOverrides =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .reduce<TModelOverrides>(
      (parsed, entry) => {
        const equals = entry.indexOf('=')
        if (equals === -1) {
          return {
            overrides: parsed.overrides,
            warnings: [
              ...parsed.warnings,
              `--model: ignored '${entry}' — name the activity it applies to, as <activity>=<provider/model>@<thinking>`,
            ],
          }
        }

        const name = entry.slice(0, equals).trim()
        const setting = entry.slice(equals + 1).trim()
        const at = setting.lastIndexOf('@')
        const model =
          (at === -1 ? setting : setting.slice(0, at)).trim() || undefined
        const thinking =
          at === -1 ? undefined : setting.slice(at + 1).trim() || undefined
        if (name === '' || (model === undefined && thinking === undefined)) {
          return {
            overrides: parsed.overrides,
            warnings: [
              ...parsed.warnings,
              `--model: ignored '${entry}' — it sets neither a model nor a thinking level`,
            ],
          }
        }

        const validThinking =
          thinking === undefined ||
          THINKING_LEVELS.some((level) => level === thinking)
        const repeated = parsed.overrides.some((one) => one.name === name)

        return {
          overrides: [
            ...parsed.overrides.filter((one) => one.name !== name),
            { name, model, thinking: validThinking ? thinking : undefined },
          ],
          warnings: [
            ...parsed.warnings,
            ...(validThinking
              ? []
              : [
                  `--model: ignored thinking level '${thinking}' for '${name}' — use one of ${THINKING_LEVELS.join(', ')}`,
                ]),
            ...(repeated
              ? [
                  `--model: '${name}' is named more than once — using '${entry}'`,
                ]
              : []),
          ],
        }
      },
      { overrides: [], warnings: [] },
    )
