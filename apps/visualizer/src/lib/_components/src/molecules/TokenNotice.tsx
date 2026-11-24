/**
 * What to say when a write was refused, and how to fix it.
 *
 * The server holds `CRUST_TOKEN` and the page cannot know it, so the only
 * honest response to a 401 is to say so and offer somewhere to paste it. A
 * button that silently does nothing reads as broken rather than locked, and
 * the person goes looking for a bug instead of for a token.
 *
 * It appears only AFTER a refusal. Asking for a credential up front, on a
 * dashboard whose reads need none, teaches people to paste secrets into any
 * box that asks.
 */
import { useId, useState } from 'react'
import { readToken, writeToken } from '@/lib/api-client'

export const TokenNotice = ({
  problem,
  onSaved,
}: Readonly<{ problem: string; onSaved: () => void }>) => {
  const [token, setToken] = useState(readToken)
  // Generated, not written: a literal id would collide the moment a second
  // notice appears on a page, and the label would point at the wrong input.
  const fieldId = useId()

  if (problem === '') return undefined

  return (
    <section
      className="@container m-0 mb-3.5 rounded-md border-[length:var(--rule-width,1px)] border-amber/45 border-l-4 border-l-amber bg-amber/8 px-3.5 py-3"
      aria-live="polite"
    >
      <p className="m-0 mb-2.5 text-[0.85rem]">{problem}</p>
      <form
        className="flex flex-col gap-2 @sm:flex-row @sm:flex-wrap @sm:items-center"
        onSubmit={(event) => {
          event.preventDefault()
          writeToken(token)
          onSaved()
        }}
      >
        <label
          className="text-xs leading-normal tracking-[0.04em] lowercase"
          htmlFor={fieldId}
        >
          write token
        </label>
        <input
          id={fieldId}
          type="password"
          // Issue #171 SC3: unchanged appearance; the removed rule supplied native control leading and placeholder colour.
          className="leading-[normal] placeholder:[color:revert] min-w-0 flex-auto rounded-sm border-none px-2 py-1.5 font-mono text-[0.8rem] focus-visible:outline-none focus-visible:outline-offset-2 @sm:basis-56"
          value={token}
          placeholder="CRUST_TOKEN"
          autoComplete="off"
          onChange={(event) => setToken(event.target.value)}
        />
        <button
          type="submit"
          className="[font-family:revert] leading-[normal] cursor-pointer rounded-sm border-none px-3 py-1.5 text-[0.8rem] focus-visible:outline-none focus-visible:outline-offset-2"
        >
          save token
        </button>
      </form>
      <p className="m-0 mt-2 text-xs leading-normal [&_code]:font-mono [&_code]:text-[0.72rem]">
        It is the value the server was started with:{' '}
        <code>CRUST_TOKEN=… crust observe</code>. Kept in this browser only,
        never sent anywhere but your own server.
      </p>
    </section>
  )
}
