import {
  Activity,
  AlignLeft,
  Brain,
  Fingerprint,
  Inbox,
  MessagesSquare,
  MessageSquareText,
  Package,
  Receipt,
  Scale,
  ShieldCheck,
  SlidersHorizontal,
  SquareTerminal,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { eventLabel, parseAgentStart, parseToolCall } from '../lib/events'
import { fmtClock, payloadOk, ts } from '../lib/format'
import { highlightJson, highlightJsonText } from '../lib/highlight'
import { modelIcon, modelName } from '../lib/models'
import {
  checksLabel,
  eventDurationMs,
  gateChecks,
  money,
  activityRunUsage,
  requestText,
  violations,
} from '../lib/activity-run-facts'
import { needsYou, activityRunLedger } from '../lib/ledger'
import type { TArtifact } from '../lib/artifacts'
import { activityRunArtifacts, runArtifacts } from '../lib/artifacts'
import type { Envelope, EventRow, GateResult, ActivityRun } from '../lib/types'
import { useHandoff } from '../lib/use-handoff'
import { usePrompts } from '../lib/use-prompts'
import { consultsFor, consultsOf } from '../lib/consult'
import { ArtifactList } from './ArtifactList'
import { DecisionLedger } from './DecisionLedger'
import { DetailSection } from './DetailSection'
import { DocumentViewer } from './DocumentViewer'
import { NarrationPane } from './NarrationPane'
import { RunControls } from './RunControls'
import { StatChip } from './StatChip'
import { StatusChip } from './StatusChip'
import styles from './ActivityRunDetail.module.css'

const NUM = new Intl.NumberFormat('en-US')

const TYPE_CLASS: Readonly<Record<string, string>> = {
  gate_fail: 't-red',
  error: 't-red',
  gate_pass: 't-green',
  tool_call: 't-cyan',
  handoff: 't-violet',
  agent_start: 't-purple',
  agent_end: 't-green',
}

/** A set of open ids, with the toggle every section in here needs. */
const useOpenSet = <TKey extends string | number>(resetKey: string) => {
  const [state, setState] = useState<{ key: string; open: readonly TKey[] }>({
    key: resetKey,
    open: [],
  })
  /*
   * The trace view replaces the activityRun object on every poll tick, so open and
   * closed state is keyed on activity_run_id — a stable string. Without that, a
   * reader's choices would snap shut twice a second.
   */
  const open = state.key === resetKey ? state.open : []
  return {
    has: (id: TKey) => open.includes(id),
    toggle: (id: TKey) =>
      setState({
        key: resetKey,
        open: open.includes(id) ? open.filter((x) => x !== id) : [...open, id],
      }),
    set: (id: TKey, value: boolean) =>
      setState({
        key: resetKey,
        open: value ? [...new Set([...open, id])] : open.filter((x) => x !== id),
      }),
  }
}

/**
 * The three things a reader wants from a step, one at a time.
 *
 * They used to be two columns side by side, which meant the configuration
 * that produced a step — prompts, gates, cost — competed for width with what
 * the step actually said. Tabs rather than a longer page because these are
 * different questions, not different parts of one answer: "what was it told",
 * "what did it say", "what did it do".
 *
 * Chat opens first. Someone who clicked a step wants to know what it thought,
 * and the configuration is what you go looking for afterwards.
 */
type TTab = 'chat' | 'highlights' | 'context' | 'events'

export const ActivityRunDetail = ({
  activityRun,
  runId,
  runStatus,
  events,
  envelopes,
  gates,
  activityRuns,
  workspace,
  onClose,
}: Readonly<{
  activityRun: ActivityRun
  runId: string
  /** the RUN's status, not the activity-run's — the chat input talks to the run */
  runStatus: string
  events: readonly EventRow[]
  envelopes: readonly Envelope[]
  gates: readonly GateResult[]
  /** Every activityRun of the run, so a steer can name what it would replay. */
  activityRuns: readonly ActivityRun[]
  /** the tree this run is in — prompts and steering are files beside it */
  workspace?: string
  onClose: () => void
}>) => {
  const activityRunEvents = useMemo(
    () =>
      events
        .filter((event) => event.activity_run_id === activityRun.activity_run_id)
        .toSorted((a, b) => a.rowid - b.rowid),
    [events, activityRun.activity_run_id],
  )

  const activityRunGates = useMemo(
    () =>
      gates
        .filter((gate) => gate.activity_run_id === activityRun.activity_run_id)
        .toSorted(
          (a, b) => (a.attempt ?? 0) - (b.attempt ?? 0) || a.id - b.id,
        ),
    [gates, activityRun.activity_run_id],
  )

  const activityRunOutputs = useMemo(
    () =>
      envelopes
        .filter((envelope) => envelope.activity_run_id === activityRun.activity_run_id)
        .toSorted((a, b) => (a.attempt ?? 0) - (b.attempt ?? 0)),
    [envelopes, activityRun.activity_run_id],
  )

  /*
   * The agent's configuration, carried on its activity-run's `agent_start` event.
   * Older rows carry only model and thinking — rows render what was recorded.
   */
  const agentConfig = useMemo(() => {
    if (activityRun.kind !== 'agent') return undefined
    const start = activityRunEvents.find((event) => event.type === 'agent_start')
    return start ? (parseAgentStart(start) ?? undefined) : undefined
  }, [activityRun.kind, activityRunEvents])

  const usage = useMemo(() => activityRunUsage(activityRun, activityRunEvents), [activityRun, activityRunEvents])
  const ask = useMemo(() => requestText(activityRun, activityRunEvents), [activityRun, activityRunEvents])

  const sections = useOpenSet<string>(activityRun.activity_run_id)
  const openGates = useOpenSet<number>(activityRun.activity_run_id)
  const openEvents = useOpenSet<string>(activityRun.activity_run_id)
  const openPanels = useOpenSet<string>(activityRun.activity_run_id)
  const rawView = useOpenSet<string>(activityRun.activity_run_id)

  const prompts = usePrompts(activityRun, workspace)

  /*
   * The documents this step produced, from the envelope it reported and the
   * directory it wrote into. Listed in both tabs from one source, so the two
   * cannot disagree about what a step produced.
   */
  const handoff = useHandoff(runId, workspace, events)
  const artifacts = useMemo(
    () =>
      activityRunArtifacts(
        runArtifacts({ runId, envelopes, events, present: handoff }),
        activityRun.activity_run_id,
      ),
    [runId, envelopes, events, handoff, activityRun.activity_run_id],
  )
  const [viewing, setViewing] = useState<TArtifact | undefined>(undefined)

  /*
   * What a steer from this step would re-run: this step and everything
   * after it, by the sequence the run actually took rather than the order
   * the config declares — a run that regressed once is described by its
   * trace, not by its configuration.
   */
  const replaying = useMemo(() => {
    const target = activityRuns.filter((entry) => entry.name === activityRun.name).at(-1)
    if (target === undefined) return []
    return [
      ...new Set(
        activityRuns
          .filter((entry) => (entry.seq ?? 0) >= (target.seq ?? 0))
          .map((entry) => entry.name ?? ''),
      ),
    ].filter((name) => name !== '')
  }, [activityRuns, activityRun.name])

  /*
   * Questions put to this step after it finished. They hang off the activityRun
   * rather than the run, so a reader finds an answer where the question
   * made sense.
   */
  const consults = useMemo(
    () => consultsFor(consultsOf(events), activityRun.activity_run_id),
    [events, activityRun.activity_run_id],
  )

  /*
   * Keyed to the activityRun, so selecting a different step opens on chat again
   * rather than leaving you on whichever tab the last step was showing.
   */
  const [tab, setTab] = useState<{ activityRun: string; name: TTab }>({
    activityRun: activityRun.activity_run_id,
    name: 'chat',
  })
  const active: TTab = tab.activityRun === activityRun.activity_run_id ? tab.name : 'chat'
  const show = (name: TTab) => () => setTab({ activityRun: activityRun.activity_run_id, name })

  const ledger = useMemo(
    () => activityRunLedger(activityRun.activity_run_id, envelopes, events),
    [activityRun.activity_run_id, envelopes, events],
  )

  const activityRunDurationMs = useMemo(() => {
    const start = ts(activityRun.started_at)
    if (!Number.isFinite(start)) return Number.NaN
    const end = activityRun.status === 'running' ? Date.now() : ts(activityRun.ended_at)
    return Number.isFinite(end) ? end - start : Number.NaN
  }, [activityRun.started_at, activityRun.ended_at, activityRun.status])

  return (
    <section className={styles.detail}>
      <header className={styles.head}>
        <div className={styles.main}>
          <span className={styles.name}>{activityRun.name}</span>
          <StatusChip status={activityRun.status ?? 'queued'} />
          {Number.isFinite(activityRunDurationMs) && (
            <StatChip kind="runtime" value={activityRunDurationMs} />
          )}
        </div>
        <div className={styles.tags}>
          <span className={styles.tag}>
            <span className={styles.tagK}>owner</span>
            <span className={styles.tagV}>{activityRun.owner ?? '—'}</span>
          </span>
          <span className={styles.tag}>
            <span className={styles.tagK}>kind</span>
            <span className={styles.tagV}>{activityRun.kind ?? '—'}</span>
          </span>
          <span className={styles.tag}>
            <span className={styles.tagK}>attempt</span>
            <span className={styles.tagV}>
              {activityRun.attempt ?? 0}/{activityRun.retries ?? 0}
            </span>
          </span>
        </div>
        <button
          type="button"
          className={styles.close}
          title="close"
          onClick={onClose}
        >
          ✕
        </button>
      </header>

      {activityRun.error && <div className={`error-bar ${styles.error}`}>{activityRun.error}</div>}

      <DocumentViewer
        artifact={viewing}
        runId={runId}
        workspace={workspace}
        onClose={() => setViewing(undefined)}
      />

      <div className={styles.tabs} role="tablist" aria-label="step detail">
        <button
          type="button"
          role="tab"
          aria-selected={active === 'chat'}
          className={active === 'chat' ? `${styles.tab} ${styles.on}` : styles.tab}
          onClick={show('chat')}
        >
          <MessageSquareText size={16} strokeWidth={2} /> chat
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={active === 'highlights'}
          className={
            active === 'highlights' ? `${styles.tab} ${styles.on}` : styles.tab
          }
          onClick={show('highlights')}
        >
          <Scale size={16} strokeWidth={2} /> highlights
          {/*
            The badge counts what is still ASKED of a reader, not everything
            the step recorded. A step with nine assumptions and nothing open
            is not asking for anything, and a badge that counts settled
            decisions cries wolf on every step. It moved here with the thing
            it counts: a badge on a tab that no longer holds them points at
            nothing.
          */}
          {needsYou(ledger) > 0 && (
            <span className={styles.badge}>{needsYou(ledger)}</span>
          )}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={active === 'context'}
          className={active === 'context' ? `${styles.tab} ${styles.on}` : styles.tab}
          onClick={show('context')}
        >
          <SlidersHorizontal size={16} strokeWidth={2} /> context
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={active === 'events'}
          className={active === 'events' ? `${styles.tab} ${styles.on}` : styles.tab}
          onClick={show('events')}
        >
          <Activity size={16} strokeWidth={2} /> events ({activityRunEvents.length})
        </button>
      </div>

      {active === 'chat' && (
        <div className={styles.chat}>
          {/*
            One column, the full width of the panel. The conversation is the
            thing being read here, and it was sharing the width with a
            ledger that is not part of it — which has its own tab now.
          */}
          <div className={styles.chatCols}>
            <div className={styles.chatCol}>
              <h4 className={styles.colHead}>thinking</h4>
              {activityRun.kind === 'agent' ? (
                <div className={styles.colBodyFlush}>
                  <NarrationPane
                    events={activityRunEvents}
                    agent={activityRun.owner ?? activityRun.name ?? 'agent'}
                    envelope={activityRunOutputs.at(-1)}
                    activityRunStatus={activityRun.status ?? ''}
                    consults={consults}
                    runId={runId}
                    runStatus={runStatus}
                  />
                </div>
              ) : (
                <div className={`${styles.colBody} faint`}>
                  this step ran code, not an agent
                </div>
              )}
            </div>
          </div>
          <RunControls
            runId={runId}
            status={runStatus}
            workspace={workspace}
            consultStep={activityRun.kind === 'agent' ? (activityRun.name ?? '') : undefined}
            replaying={replaying}
          />
        </div>
      )}

      {/*
        Hidden rather than unmounted, like the others: a reader who scrolled
        a long ledger and stepped away to the conversation should come back
        to where they were.
      */}
      <div className={active === 'highlights' ? styles.highlights : styles.hidden}>
        <DecisionLedger ledger={ledger} />
        {artifacts.length > 0 && (
          <section className={styles.documents}>
            <h5 className={styles.documentsHead}>documents</h5>
            <ArtifactList artifacts={artifacts} onOpen={setViewing} />
          </section>
        )}
      </div>

      <div className={active === 'context' ? styles.grid : styles.hidden}>
        <div className={styles.col}>
          {ask !== undefined && (
            <DetailSection
              title="request"
              icon={Inbox}
              open={sections.has('request')}
              onToggle={() => sections.toggle('request')}
            >
              <p className={styles.request}>{ask}</p>
            </DetailSection>
          )}

          {agentConfig !== undefined && (
            <DetailSection
              title="agent config"
              icon={SlidersHorizontal}
              open={sections.has('config')}
              onToggle={() => sections.toggle('config')}
            >
              <div className={styles.cfg}>
                {agentConfig.coding_agent && (
                  <div className={styles.cfgRow}>
                    <span className={styles.cfgK}>coding agent</span>
                    <span className={styles.cfgChip}>
                      <SquareTerminal className={styles.cfgIcon} size={18} strokeWidth={2} />
                      {agentConfig.coding_agent}
                    </span>
                  </div>
                )}
                {agentConfig.model && (
                  <div className={styles.cfgRow}>
                    <span className={styles.cfgK}>model</span>
                    <span className={styles.cfgChip} title={agentConfig.model}>
                      {modelIcon(agentConfig.model) !== null && (
                        <img
                          className={styles.cfgModelIcon}
                          src={modelIcon(agentConfig.model) ?? ''}
                          alt=""
                        />
                      )}
                      {modelName(agentConfig.model)}
                    </span>
                  </div>
                )}
                {agentConfig.thinking && (
                  <div className={styles.cfgRow}>
                    <span className={styles.cfgK}>thinking</span>
                    <span className={styles.cfgChip}>
                      <Brain className={styles.cfgIcon} size={18} strokeWidth={2} />
                      {agentConfig.thinking}
                    </span>
                  </div>
                )}
                {agentConfig.tools !== undefined && (
                  <div className={styles.cfgRow}>
                    <span className={styles.cfgK}>tools</span>
                    {agentConfig.tools === null ? (
                      <span className={styles.cfgV}>all tools</span>
                    ) : (
                      <span className={styles.cfgChips}>
                        {agentConfig.tools.map((tool) => (
                          <span key={tool} className={styles.cfgChip}>
                            {tool}
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                )}
                {agentConfig.harness_engineering !== undefined && (
                  <div className={styles.cfgRow}>
                    <span className={styles.cfgK}>harness</span>
                    {agentConfig.harness_engineering?.length ? (
                      <span className={styles.cfgChips}>
                        {agentConfig.harness_engineering.map((item) => (
                          <span key={item} className={styles.cfgChip}>
                            {item}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className={`${styles.cfgV} dim`}>none</span>
                    )}
                  </div>
                )}
                {agentConfig.purpose && (
                  <div className={styles.cfgRow}>
                    <span className={styles.cfgK}>purpose</span>
                    <span className={styles.cfgV}>{agentConfig.purpose}</span>
                  </div>
                )}
                {agentConfig.session_id && (
                  <div className={styles.cfgRow}>
                    <span className={styles.cfgK}>session</span>
                    <span className={styles.cfgChip}>
                      <Fingerprint className={styles.cfgIcon} size={18} strokeWidth={2} />
                      {agentConfig.session_id}
                    </span>
                  </div>
                )}
              </div>
            </DetailSection>
          )}

          {activityRun.description && (
            <DetailSection
              title="description"
              icon={AlignLeft}
              open={sections.has('description')}
              onToggle={() => sections.toggle('description')}
            >
              <p className={styles.desc}>{activityRun.description}</p>
            </DetailSection>
          )}

          {activityRun.kind === 'agent' && (
            <DetailSection
              title="compiled prompts"
              icon={MessagesSquare}
              count={prompts.state === 'ready' ? prompts.panels.length : undefined}
              open={sections.has('prompts')}
              onToggle={() => sections.toggle('prompts')}
            >
              {prompts.state === 'loading' && <div className="faint">loading prompts…</div>}
              {prompts.state === 'error' && <div className="faint">prompts unavailable</div>}
              {prompts.state === 'ready' && prompts.panels.length === 0 && (
                <div className="faint">no compiled prompts recorded</div>
              )}
              {prompts.state === 'ready' &&
                prompts.panels.map((panel) => (
                  <div key={panel.id} className={styles.promptPanel}>
                    <button
                      type="button"
                      className={styles.promptHead}
                      onClick={() => openPanels.toggle(panel.id)}
                    >
                      <span className={styles.chev}>
                        {openPanels.has(panel.id) ? '▾' : '▸'}
                      </span>
                      <span className={styles.promptTitle}>{panel.title}</span>
                      <span className="dim">{panel.lines} lines</span>
                    </button>
                    {openPanels.has(panel.id) && (
                      <div className={styles.promptBody}>
                        <div className={styles.promptTools}>
                          <button
                            type="button"
                            className={rawView.has(panel.id) ? undefined : styles.active}
                            onClick={() => rawView.set(panel.id, false)}
                          >
                            rendered
                          </button>
                          <button
                            type="button"
                            className={rawView.has(panel.id) ? styles.active : undefined}
                            onClick={() => rawView.set(panel.id, true)}
                          >
                            raw
                          </button>
                        </div>
                        {rawView.has(panel.id) ? (
                          <pre className={styles.promptRaw}>{panel.text}</pre>
                        ) : (
                          // Safe: renderMarkdown escapes ALL input before
                          // emitting its own tags.
                          <div
                            className="md"
                            // biome-ignore lint/security/noDangerouslySetInnerHtml: renderMarkdown escapes its input
                            dangerouslySetInnerHTML={{ __html: panel.html }}
                          />
                        )}
                      </div>
                    )}
                  </div>
                ))}
            </DetailSection>
          )}

          <DetailSection
            title="gates"
            icon={ShieldCheck}
            count={activityRunGates.length}
            open={sections.has('gates')}
            onToggle={() => sections.toggle('gates')}
          >
            {activityRunGates.length === 0 && <div className="faint">no gate results</div>}
            {activityRunGates.map((gate) => {
              const checks = gateChecks(gate)
              const failures = violations(gate)
              return (
                <div
                  key={gate.id}
                  className={`${styles.gate} ${gate.passed ? styles.pass : styles.fail}`}
                >
                  {checks !== undefined ? (
                    <>
                      <button
                        type="button"
                        className={`${styles.gateLine} ${styles.gateToggle}`}
                        onClick={() => openGates.toggle(gate.id)}
                      >
                        <span className={styles.chev}>
                          {openGates.has(gate.id) ? '▾' : '▸'}
                        </span>
                        <span className={styles.gateMark}>{gate.passed ? '✓' : '✗'}</span>
                        <span className={styles.gateName}>{gate.gate}</span>
                        <span
                          className={
                            gate.passed ? styles.tag : `${styles.tag} ${styles.tagFail}`
                          }
                        >
                          <span className={styles.tagK}>checks</span>
                          <span className={styles.tagV}>{checksLabel(checks)}</span>
                        </span>
                        <span className={styles.tag}>
                          <span className={styles.tagK}>attempt</span>
                          <span className={styles.tagV}>{gate.attempt ?? 0}</span>
                        </span>
                        <span className={`dim ${styles.gateTime}`}>
                          {fmtClock(gate.created_at)}
                        </span>
                      </button>
                      {openGates.has(gate.id) && (
                        <div className={styles.gateChecks}>
                          {checks.length === 0 && (
                            <div className="faint">
                              nothing to check — the gate inspected no items
                            </div>
                          )}
                          {checks.map((check) => (
                            <div
                              key={`${gate.id}-${check.item}`}
                              className={`${styles.gateCheck} ${check.ok ? styles.pass : styles.fail}`}
                            >
                              <span className={styles.checkMark}>{check.ok ? '✓' : '✗'}</span>
                              <span className={styles.checkItem}>{check.item}</span>
                              {/*
                                A failed tests_pass note is "exit N" plus a
                                command-output tail: multi-line evidence gets a
                                block, one-liners stay inline.
                              */}
                              {check.note?.includes('\n') ? (
                                <pre className={styles.checkNoteBlock}>{check.note}</pre>
                              ) : check.note ? (
                                <span className={`${styles.checkNote} dim`}>{check.note}</span>
                              ) : undefined}
                            </div>
                          ))}
                          {!gate.passed && failures.length > 0 && (
                            <ul className={styles.violations}>
                              {failures.map((failure) => (
                                <li key={failure}>{failure}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className={styles.gateLine}>
                        <span className={styles.gateMark}>{gate.passed ? '✓' : '✗'}</span>
                        <span className={styles.gateName}>{gate.gate}</span>
                        <span className={styles.tag}>
                          <span className={styles.tagK}>attempt</span>
                          <span className={styles.tagV}>{gate.attempt ?? 0}</span>
                        </span>
                        <span className={`dim ${styles.gateTime}`}>
                          {fmtClock(gate.created_at)}
                        </span>
                      </div>
                      {failures.length > 0 && (
                        <ul className={styles.violations}>
                          {failures.map((failure) => (
                            <li key={failure}>{failure}</li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </DetailSection>

          {usage !== undefined && (
            <DetailSection
              title="cost"
              icon={Receipt}
              open={sections.has('cost')}
              onToggle={() => sections.toggle('cost')}
            >
              <table className={styles.usage}>
                <thead>
                  <tr>
                    <th className={styles.usageK} />
                    <th className={styles.usageN}>tokens</th>
                    <th className={styles.usageC}>cost</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.rows.map((row) => (
                    <tr
                      key={row.label}
                      className={row.kind === undefined ? undefined : styles[row.kind]}
                      title={row.title}
                    >
                      <td className={styles.usageK}>{row.label}</td>
                      <td className={styles.usageN}>{NUM.format(row.tokens)}</td>
                      <td className={styles.usageC}>{money(row.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {usage.partial && (
                <p className={`faint ${styles.usageNote}`}>
                  this run predates the per-component breakdown — only the total was
                  recorded
                </p>
              )}
            </DetailSection>
          )}

          <DetailSection
            title="outputs"
            icon={Package}
            count={activityRunOutputs.length + artifacts.length}
            open={sections.has('outputs')}
            onToggle={() => sections.toggle('outputs')}
          >
            {artifacts.length > 0 && (
              <div className={styles.documents}>
                <ArtifactList artifacts={artifacts} onOpen={setViewing} />
              </div>
            )}
            {activityRunOutputs.length === 0 && artifacts.length === 0 && (
              <div className="faint">no outputs</div>
            )}
            {activityRunOutputs.map((envelope) => (
              <div key={envelope.envelope_id} className={styles.output}>
                <div className={styles.outputLine}>
                  <span className={styles.outputType}>{envelope.output_type}</span>
                  <span className={styles.tag}>
                    <span className={styles.tagK}>agent</span>
                    <span className={styles.tagV}>{envelope.agent ?? '—'}</span>
                  </span>
                  <span className={styles.tag}>
                    <span className={styles.tagK}>attempt</span>
                    <span className={styles.tagV}>{envelope.attempt ?? 0}</span>
                  </span>
                  <span
                    className={`${styles.outputValid} ${envelope.valid ? styles.pass : styles.fail}`}
                  >
                    {envelope.valid ? 'valid' : 'invalid'}
                  </span>
                </div>
                {/* Safe: highlightJson escapes ALL input before emitting its own spans. */}
                <pre
                  // biome-ignore lint/security/noDangerouslySetInnerHtml: highlightJson escapes its input
                  dangerouslySetInnerHTML={{ __html: highlightJson(envelope.payload_json) }}
                />
              </div>
            ))}
          </DetailSection>
        </div>
      </div>

      <div className={active === 'events' ? styles.events : styles.hidden}>
        <div className={styles.col}>
          {activityRunEvents.length === 0 && <div className="faint">no events</div>}
          {activityRunEvents.map((event) => {
            const duration = eventDurationMs(event)
            const call = event.type === 'tool_call' ? parseToolCall(event) : null
            const open = openEvents.has(event.event_id)
            return (
              <div key={event.event_id} className={styles.event}>
                <button
                  type="button"
                  className={open ? `${styles.eventRow} ${styles.open}` : styles.eventRow}
                  onClick={() => openEvents.toggle(event.event_id)}
                >
                  <span className={`${styles.eventTime} dim`}>
                    {fmtClock(event.started_at)}
                  </span>
                  <span className={`${styles.eventType} ${TYPE_CLASS[event.type ?? ''] ?? ''}`}>
                    {event.type}
                  </span>
                  <span
                    className={
                      event.type === 'tool_call' && payloadOk(event.payload_json)
                        ? styles.eventName
                        : `${styles.eventName} t-red`
                    }
                    title={eventLabel(event)}
                  >
                    {eventLabel(event)}
                  </span>
                  <span className={styles.eventExtra}>
                    {Number.isFinite(duration) && (
                      <StatChip kind="runtime" compact value={duration} />
                    )}
                    {event.tokens ? (
                      <StatChip kind="tokens" compact value={event.tokens} />
                    ) : undefined}
                  </span>
                </button>

                {open && (
                  <div className={styles.payloadPanel}>
                    {call !== null ? (
                      <>
                        <div className={styles.payloadMeta}>
                          <span className={styles.payloadTool}>{call.tool}</span>
                          {call.ok === false && <span className="t-red">failed</span>}
                          {call.duration_ms != null && (
                            <StatChip kind="runtime" compact value={call.duration_ms} />
                          )}
                        </div>
                        <h4>args</h4>
                        <pre
                          className={styles.payloadPre}
                          // biome-ignore lint/security/noDangerouslySetInnerHtml: highlightJsonText escapes its input
                          dangerouslySetInnerHTML={{
                            __html: highlightJsonText(
                              JSON.stringify(call.args ?? {}, null, 2),
                            ),
                          }}
                        />
                        {call.result_snippet && (
                          <>
                            <h4>result</h4>
                            <pre className={styles.payloadPre}>{call.result_snippet}</pre>
                          </>
                        )}
                      </>
                    ) : event.type === 'tool_call' && event.payload_json ? (
                      <>
                        <div className="faint">no detail available — legacy event payload</div>
                        <pre
                          className={styles.payloadPre}
                          // biome-ignore lint/security/noDangerouslySetInnerHtml: highlightJson escapes its input
                          dangerouslySetInnerHTML={{
                            __html: highlightJson(event.payload_json),
                          }}
                        />
                      </>
                    ) : event.payload_json ? (
                      <>
                        <h4>payload</h4>
                        <pre
                          className={styles.payloadPre}
                          // biome-ignore lint/security/noDangerouslySetInnerHtml: highlightJson escapes its input
                          dangerouslySetInnerHTML={{
                            __html: highlightJson(event.payload_json),
                          }}
                        />
                      </>
                    ) : (
                      <div className="faint">no payload</div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
