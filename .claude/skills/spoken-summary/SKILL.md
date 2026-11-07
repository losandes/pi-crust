---
name: spoken-summary
description: Speaks a one-or-two sentence summary aloud when a long task finishes, so the developer can step away and still learn the outcome. Use when explicitly asked for a "spoken summary", "audio summary", "tts", or "say that", or when asked to announce or notify on completion. Also appropriate unprompted after a task that ran long enough for the developer to have left the keyboard — a full test run, a large refactor, a long build — when they said they were stepping out. Defaults for any project — use this only when the project itself advertises no equivalent convention skill of its own, which always wins.
---

# Spoken Summary

## Use this skill when

- Asked for a "spoken summary", "audio summary", "tts", or "read that out"
- Asked to announce, notify, or alert when something finishes
- A long task completes and the developer said they were stepping away

## Do not use this skill when

- The task took seconds. Speaking is slower than reading; announcing a quick result wastes the time it claims to save
- The answer is the work itself. Speech cannot convey a diff, a path, or a count worth checking — speak the outcome, leave the detail on screen
- You are unsure whether anyone is listening. A muted machine, a shared screen, or a meeting all make this an intrusion. When in doubt, don't

## Write for inspection

Prose this skill produces follows [write-from-evidence.md](../adr/conventions/write-from-evidence.md): lead with the finding or decision, support it with evidence, distinguish observation from inference, make material uncertainty inspectable, and stop once the reader can evaluate and act on it. No checker enforces this.

## Usage

```bash
scripts/speak.sh "Tier three landed. Twenty six new violations, all in one package."
```

The script exits 0 when spoken, 2 on misuse, and 3 when no synthesiser exists — 3 is not a failure worth reporting, and the text is echoed instead.

It writes no files. Speech is transient by nature, and the predecessor of this skill saved an audio file per run that nobody ever played twice.

Set `SPOKEN_SUMMARY=off` to suppress speech and echo the text instead. Speech is also suppressed automatically when `CI` is set.

## What to say

Two sentences, maximum. The first is what happened; the second is the decision waiting, if there is one.

The constraint is not stylistic. A listener cannot skim, re-read, or skip ahead, so every clause is paid for in the only order it can be received. Anything that would be scanned past on screen becomes an obstacle in audio.

| Say | Not |
|---|---|
| "Tests pass. Two hundred and eighty three immutability violations, all pre-existing." | "I have finished running the test suite and I am pleased to report..." |
| "Lint fails in storage on eight parameter reassignments. Fix or leave as debt?" | "There were some linting issues found in various files." |

Rules that matter in audio and nowhere else:

- **No paths, no line numbers, no identifiers.** `resolve-episodes-by-show.ts:152` is noise aloud. Say which package, leave the rest on screen
- **Round the numbers.** "About three hundred" beats "two hundred eighty three" unless the exact figure is the point
- **Lead with the outcome**, not the process. The listener wants to know whether to come back
- **Name the decision if one is waiting.** That is the only reason to interrupt someone who stepped away
- **No greeting, no sign-off, no name.** They know who is talking

## After speaking

Report in the conversation as normal. Speech is an addition to the written summary, never a replacement — the developer will read the transcript when they return, and it needs to stand alone.
