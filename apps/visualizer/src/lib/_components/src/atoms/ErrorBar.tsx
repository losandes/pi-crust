const BOX =
  'rounded-lg border-(length:--border-width) border-fail/[calc(var(--edge-alpha)*100%)] bg-fail/[calc(var(--fill-soft)*100%)] px-3.5 py-2.5 text-base text-red'

const PLACEMENT = {
  page: 'mx-6 my-3',
  panel: 'mx-4.5 mt-3.5 mb-0',
} as const

export const ErrorBar = ({
  message,
  placement = 'page',
}: Readonly<{ message: string; placement?: keyof typeof PLACEMENT }>) => (
  <div className={`${BOX} ${PLACEMENT[placement]}`}>{message}</div>
)
