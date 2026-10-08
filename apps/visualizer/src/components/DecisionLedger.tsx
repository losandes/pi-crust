/**
 * What a step decided, assumed, and could not settle — beside its thinking.
 *
 * This column is the other half of the trust dial. A chain that answers its
 * own questions instead of stopping is only safe if every one of those
 * answers is impossible to miss, and until now they were buried in an
 * envelope that rendered as a wall of JSON in a collapsed panel.
 *
 * Questions come first and decisions second, because a question is a thing a
 * reader may still have to act on and a decision is a thing they are being
 * told. Assumptions come last: they are the softest claim a step makes and
 * the least likely to need a response today.
 */
import type { TPhaseLedger, TQuestionOutcome } from '../lib/ledger'
import styles from './DecisionLedger.module.css'

const OUTCOME_LABEL: Readonly<Record<TQuestionOutcome, string>> = {
  decided: 'it decided',
  escalated: 'it asked you',
  open: 'open',
}

export const DecisionLedger = ({
  ledger,
}: Readonly<{ ledger: TPhaseLedger }>) => {
  if (ledger.total === 0) {
    return (
      <div className={styles.empty}>
        This step reported nothing it decided, assumed, or could not answer.
      </div>
    )
  }

  return (
    <div className={styles.ledger}>
      {ledger.questions.length > 0 && (
        <section className={styles.group}>
          <h4 className={styles.groupHead}>questions</h4>
          {ledger.questions.map((entry) => (
            <article
              key={entry.question}
              className={`${styles.card} ${styles[entry.outcome]}`}
            >
              <header className={styles.cardHead}>
                <span className={styles.outcome}>
                  {OUTCOME_LABEL[entry.outcome]}
                </span>
                {entry.beyond_this_run && (
                  <span className={styles.flag}>beyond this run</span>
                )}
                {entry.consequential && (
                  <span className={styles.flag}>consequential</span>
                )}
              </header>
              <p className={styles.question}>{entry.question}</p>
              {entry.provisional_answer === '' ? (
                <p className={styles.noAnswer}>
                  It had no answer it was prepared to defend.
                </p>
              ) : (
                <p className={styles.answer}>{entry.provisional_answer}</p>
              )}
            </article>
          ))}
        </section>
      )}

      {ledger.decisions.length > 0 && (
        <section className={styles.group}>
          <h4 className={styles.groupHead}>decisions</h4>
          {ledger.decisions.map((entry) => (
            <article key={entry.decision} className={styles.card}>
              <p className={styles.question}>{entry.decision}</p>
              {entry.rationale !== '' && (
                <p className={styles.because}>{entry.rationale}</p>
              )}
            </article>
          ))}
        </section>
      )}

      {ledger.assumptions.length > 0 && (
        <section className={styles.group}>
          <h4 className={styles.groupHead}>assumptions</h4>
          {ledger.assumptions.map((entry) => (
            <article key={entry.assumption} className={styles.card}>
              <p className={styles.question}>{entry.assumption}</p>
              {entry.invalidated_by !== '' && (
                <p className={styles.because}>
                  <span className={styles.becauseKey}>wrong if</span>{' '}
                  {entry.invalidated_by}
                </p>
              )}
            </article>
          ))}
        </section>
      )}
    </div>
  )
}
