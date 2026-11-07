# Walkthrough — a process with a commentary track

Ask for this with **"walkthrough"**.

A single rail runs the height of the process. Stages hang off it. Prose lives *inside* the diagram — the rail is the spine, the commentary is the payload, and stripping the sentences out to make it tidy destroys the thing that makes it useful.

This is **not** the form most people mean by "workflow". Reach for it when the *conditions* are the content: qualification rules, tie-breaks, the counter-intuitive consequence, the tier that is designed but not built. Those are sentences, and sentences do not fit in boxes. When the *shape* is the content — branches, merges, loops, fan-out — draw a [workflow](workflow.md) instead.

```text
┌─ THE AIRPORT CHECK-IN PROCESS — 3 stages, completed IN ORDER
│
│  STAGE 1 ── CHECK-IN (confirm passenger and flight)       ◀ everyone starts here
│  │
│  │   For each passenger, the airline verifies:
│  │      ✓ reservation exists for today's flight
│  │      ✓ passenger identity matches the reservation
│  │      ✓ required travel documents are valid
│  │      ✓ check-in is still open for the flight
│  │
│  │   RESULT = boarding pass issued
│  │            seat assigned if one hasn't been selected
│  │            passengers who fail verification need assistance
│  │
│  ▼   Checked-in passengers proceed to baggage handling.
│
│  STAGE 2 ── BAGGAGE (determine what needs to be checked)  ◀ only after check-in
│  │
│  │   Evaluate ALL bags for the passenger:
│  │      Carry-on · Personal item · Checked luggage · Oversized luggage
│  │
│  │   Each bag is classified and handled according to:
│  │      1st  size and weight restrictions
│  │      2nd  ticket allowance (number of free checked bags)
│  │      3rd  special handling requirements
│  │
│  │   DECISION = carry on, check, or pay an additional fee
│  │
│  │      ⚠ A bag exceeding carry-on dimensions must be checked,
│  │        even if the passenger has unused carry-on allowance.
│  │
│  ▼   Checked bags receive tracking tags and enter the baggage system.
│
│  STAGE 3 ── SECURITY (screen passengers and carry-ons)   ◀ before entering gates
│  │
│  │   Passengers enter ONE of two screening lanes:
│  │      STANDARD  → regular screening procedures
│  │      EXPEDITED → available to eligible travelers
│  │
│  │   Screening includes:
│  │      ✓ identity and boarding pass verification
│  │      ✓ passenger screening
│  │      ✓ carry-on baggage inspection
│  │
│  │   ⛔ If an item requires additional inspection, the passenger
│  │      cannot proceed until security resolves the issue.
│  │
│  ▼   Cleared passengers may enter the departure gate area.
│
└─ OUTCOME: Passenger is ready to board, or requires additional assistance.
```

## Rules

| Element | Means |
|---|---|
| `┌─` … `└─` | the rail opens and closes; the closing line states the fall-through case |
| `│` on every line between | the channel is continuous — a gap reads as the end of the process |
| `│  │` | a stage's own sub-rail, hanging off the main one |
| `▼` | handoff: this stage is finished and control passes down |
| `◀` | a margin aside about the stage on that line |
| `✓` | a condition that must hold |
| `⚠` | a counter-intuitive consequence, stated where it would bite |
| `⛔` | not implemented — planned, described, and explicitly not live |

- Capitalise the **load-bearing** words (`IN ORDER`, `NOT by price`). The reader is skimming; capitals are where their eye stops
- Say what is *not* true where a reader would assume otherwise. `⚠ A higher partner tier beats a lower one even at a lower CPM` is the whole reason the diagram exists
- `⛔` marks the gap between the design and the code. A diagram that draws planned behaviour as though it ships is worse than one that omits it

## The two compose

A [workflow](workflow.md) showing the shape, with a walkthrough beneath it expanding one stage, is often better than either alone — the reader gets the topology in two seconds and the conditions where they need them.
