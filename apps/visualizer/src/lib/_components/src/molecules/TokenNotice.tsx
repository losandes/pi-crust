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
import styles from './TokenNotice.module.css'

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
    <section className={styles.notice} aria-live="polite">
      <p className={styles.problem}>{problem}</p>
      <form
        className={styles.row}
        onSubmit={(event) => {
          event.preventDefault()
          writeToken(token)
          onSaved()
        }}
      >
        <label className={styles.label} htmlFor={fieldId}>
          write token
        </label>
        <input
          id={fieldId}
          type="password"
          className={styles.input}
          value={token}
          placeholder="CRUST_TOKEN"
          autoComplete="off"
          onChange={(event) => setToken(event.target.value)}
        />
        <button type="submit" className={styles.save}>
          save token
        </button>
      </form>
      <p className={styles.hint}>
        It is the value the server was started with:{' '}
        <code>CRUST_TOKEN=… just crust observe</code>. Kept in this browser
        only, never sent anywhere but your own server.
      </p>
    </section>
  )
}
