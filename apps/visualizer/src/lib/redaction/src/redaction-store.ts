import {
  createRedactor,
  redactionConfigOf,
  type TRedactor,
  type TRunRoots,
} from './redactor'

export type TRunAddress = Readonly<{ runId: string; workspace?: string }>
export type TRedactionStore = Readonly<{
  base: () => Promise<TRedactor>
  forRun: (address: TRunAddress) => Promise<TRedactor>
  remember: (address: TRunAddress, roots: TRunRoots) => void
}>

const keyOf = ({ runId, workspace }: TRunAddress): string =>
  `${workspace ?? ''}:${runId}`
const unavailable = () =>
  new Error('redaction: the API has not reported its path-redaction setting')

export const createRedactionStore = ({
  request,
  fetchHealth = async () => {
    const response = await (request ?? fetch)('/api/health')
    if (!response.ok) throw unavailable()
    return response.json()
  },
}: Readonly<{
  request?: (...args: Parameters<typeof fetch>) => Promise<Response>
  fetchHealth?: () => Promise<unknown>
}>): TRedactionStore => {
  // This cache coordinates concurrent reads; a failed request must release its slot for retry.
  let pending:
    | Promise<Readonly<{ redactor: TRedactor; enabled: boolean }>>
    | undefined
  const roots = new Map<string, TRunRoots>()
  const load = () => {
    if (pending) return pending
    pending = Promise.resolve()
      .then(fetchHealth)
      .then((health) => {
        const config = redactionConfigOf(health)
        if (!config) throw unavailable()
        return { redactor: createRedactor(config), enabled: config.enabled }
      })
      .catch(() => {
        pending = undefined
        throw unavailable()
      })
    return pending
  }
  return {
    base: async () => (await load()).redactor,
    remember: (address, value) => {
      roots.set(keyOf(address), { ...value })
    },
    forRun: async (address) => {
      const { redactor, enabled } = await load()
      const config = roots.get(keyOf(address))
      if (!enabled) return redactor
      if (!config)
        throw new Error(
          `redaction: the roots of run ${address.runId} are not known yet`,
        )
      return redactor.forRun(config)
    },
  }
}

export const redaction = createRedactionStore({})
