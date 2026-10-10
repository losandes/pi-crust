import { expect, test } from 'bun:test'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  consultArgv,
  consultEvent,
  preamble,
  runConsult,
  TOOLS,
  type TConsultMode,
  type TConsultRequest,
} from './consult'

const scratch = (): string => mkdtempSync(join(tmpdir(), 'crust-consult-'))

/** A handoff directory holding one document per owner. */
const handoff = (): Readonly<{ dir: string; sessions: string }> => {
  const root = scratch()
  const dir = join(root, 'context_handoff')
  const sessions = join(root, 'pi_sessions')
  mkdirSync(dir, { recursive: true })
  mkdirSync(sessions, { recursive: true })
  writeFileSync(join(dir, 'design.md'), 'the design, as written')
  writeFileSync(join(dir, 'plan.md'), "another step's plan")
  // Both start locked, as they would after their own steps finished.
  chmodSync(join(dir, 'design.md'), 0o444)
  chmodSync(join(dir, 'plan.md'), 0o444)
  return { dir, sessions }
}

const request = (
  mode: TConsultMode,
  dirs: Readonly<{ dir: string; sessions: string }>,
): TConsultRequest => ({
  runId: 'c35f2c7d',
  phaseId: 'c35f2c7d_05_design',
  agent: 'technical-architect',
  sessionId: 'crust-c35f2c7d-technical-architect-9650',
  sessionDir: dirs.sessions,
  handoffDir: dirs.dir,
  mode,
  question: 'why did you choose a registry table?',
  own: ['design.md'],
})

test(
  [
    'given use-cases/consult::runConsult',
    'when an amend rewrites the document its own step wrote',
    'it should keep the change and lock it again',
  ].join(', '),
  async () => {
    // given — the one overwrite that must be allowed: a step revising its
    // own output, with the whole conversation still in its context
    const dirs = handoff()

    // when — the agent edits its own document
    const outcome = await runConsult(
      request('amend', dirs),
      () =>
        Promise.resolve(
          (() => {
            writeFileSync(join(dirs.dir, 'design.md'), 'the design, amended')
            return { ok: true, output: 'done' }
          })(),
        ),
      [],
    )

    // then
    expect(outcome.amended).toEqual(['design.md'])
    expect(readFileSync(join(dirs.dir, 'design.md'), 'utf8')).toEqual(
      'the design, amended',
    )
    // locked again: the next step has no more right to it than before
    expect(() => writeFileSync(join(dirs.dir, 'design.md'), 'x')).toThrow()
  },
)

test(
  [
    'given use-cases/consult::runConsult',
    "when a consult changes another step's document",
    'it should put it back and report what it restored',
  ].join(', '),
  async () => {
    // given — the guarantee the whole feature rests on: a question can never
    // cost you work a different step did. The ordinary write is already
    // refused by the lock, so this forces it, standing in for the paths a
    // file mode cannot cover and proving the restore rather than the lock.
    const dirs = handoff()
    let refused = ''

    // when
    const outcome = await runConsult(
      request('amend', dirs),
      () => {
        try {
          writeFileSync(join(dirs.dir, 'plan.md'), 'trampled')
        } catch (cause) {
          refused = (cause as NodeJS.ErrnoException).code ?? 'refused'
          chmodSync(join(dirs.dir, 'plan.md'), 0o644)
          writeFileSync(join(dirs.dir, 'plan.md'), 'trampled')
        }
        return Promise.resolve({ ok: true, output: 'done' })
      },
      [],
    )

    // then — the lock stopped the ordinary attempt, and what got through by
    // force was put back
    expect(refused).toEqual('EACCES')
    expect(outcome.restored).toEqual(['plan.md'])
    expect(readFileSync(join(dirs.dir, 'plan.md'), 'utf8')).toEqual(
      "another step's plan",
    )
  },
)

test(
  [
    'given use-cases/consult::runConsult',
    'when the session was pruned from disk',
    'it should refuse rather than answer from an agent that remembers nothing',
  ].join(', '),
  async () => {
    // given — pruning deletes session directories, so this is an ordinary
    // end state for an old run. A fresh session would answer confidently
    // with none of the context the question assumes.
    const dirs = handoff()
    const pruned = { ...request('ask', dirs), sessionDir: '/nowhere/at/all' }
    let spawned = false

    // when
    const outcome = await runConsult(
      pruned,
      () => {
        spawned = true
        return Promise.resolve({ ok: true, output: 'should never run' })
      },
      [],
    )

    // then
    expect(spawned).toBe(false)
    expect(outcome.answered).toBe(false)
    expect(outcome.reason).toContain('no session on disk')
  },
)

test(
  [
    'given use-cases/consult::TOOLS and consultArgv',
    'when the mode is ask',
    'it should hand over no tool that can write',
  ].join(', '),
  () => {
    // given — read-only by CAPABILITY, not by instruction. `bash` is absent
    // from both modes: it is a writing tool wearing a different hat, and the
    // guarantee rests on that not being true.
    const dirs = handoff()

    // when
    const argv = consultArgv(
      request('ask', dirs),
      { provider: 'anthropic', modelId: 'claude-x' },
      'pi',
    )

    // then
    expect(TOOLS.ask).toEqual(['read', 'grep', 'find', 'ls'])
    expect(TOOLS.ask.some((tool) => ['write', 'edit', 'bash'].includes(tool))).toBe(
      false,
    )
    expect(TOOLS.amend.includes('bash')).toBe(false)
    expect(argv).toContain('--print')
    expect(argv).toContain('crust-c35f2c7d-technical-architect-9650')
    expect(argv.join(' ')).toContain('--tools read,grep,find,ls')
    // the preamble is composed into the argv, so the recorded question can
    // stay exactly what the person typed
    expect(argv.at(-1)).toContain(preamble('ask'))
    expect(argv.at(-1)).toContain('why did you choose a registry table?')
  },
)

test(
  [
    'given use-cases/consult::preamble and consultEvent',
    'when a consult is recorded',
    'it should name its mode in both the instruction and the trace',
  ].join(', '),
  () => {
    // given — the thread hangs off the phase that was asked about, so a
    // reader finds the answer where the question made sense
    const dirs = handoff()
    const asked = request('ask', dirs)

    // when
    const event = consultEvent(asked, {
      answered: true,
      answer: 'because the registry is the only stable identity.',
      amended: [],
      restored: [],
      reason: '',
    })

    // then
    expect(preamble('ask')).toContain('no writing tools')
    expect(preamble('amend')).toContain('documents YOU wrote and nothing else')
    expect(event.name).toEqual('technical-architect ask')
    expect(event.payload.question).toEqual(asked.question)
    expect(event.payload.mode).toEqual('ask')
  },
)
