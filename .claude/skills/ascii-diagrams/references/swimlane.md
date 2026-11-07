# Swimlane

Ask for this with **"swimlane"**.

Lanes are rows; time runs left to right. The time axis is a closed channel with `▶` at both ends, so lanes have an unambiguous start and finish.

```text
              ┌────────────────────────────────────────────────────────▶
              │ ┌──────────┐                ┌───────────────┐
     Spotify  │ │ /shows   │                │ batchEpisodes │
              │ └────┬─────┘                └───────┬───────┘
              │ ---- ▼ ---------------------------- ▼ -----------------
              │  ┌───────┐    ┌──────────┐    ┌───────────┐
     Gateway  │  │ probe ├───▶│ step 2   ├───▶│ match     │
              │  └───────┘    └────┬─────┘    └─────┬─────┘
              │ ------------------ ▼ -------------- │ -----------------
              │               ┌──────────┐          │
  l5 (MySQL)  │               │ show ids │          │
              │               └──────────┘          │
              │ ----------------------------------- ▼ -----------------
              │                                ┌──────────┐
      Output  │                                │ step 3   │
              │                                └──────────┘
              └────────────────────────────────────────────────────────▶
```

## Rules

- **Axis column is constant.** Every line carries `┌`, `│` or `└` in the same column. Lanes stop reading as lanes the moment the axis wanders
- **Lane titles are right-justified** into a fixed-width field with exactly **2 spaces** before the axis, and vertically centred in their lane
- **Lane dividers share a right edge.** Dash runs differ because `▼` and `│` punch through them; the terminating column does not
- **Boxes snap to a grid.** No decorative horizontal gaps: a gap between two boxes should mean elapsed time or an intervening lane, nothing else
- A crossing between lanes is drawn as `▼` through the divider, so the handoff is visible at the boundary rather than inferred from two arrows

## When it will not fit: bands

Swimlanes are the one form whose width is driven by an **unbounded** dimension. Every other form here grows downward; this one grows right with every step, having already spent a fixed field on lane titles. Four lanes and six steps passes 100 columns before the labels are written.

The tempting fixes both destroy the form: shrinking boxes until labels are cryptic, or narrowing the title field until lanes stop being scannable.

**First, check the altitude.** Most over-wide swimlanes are under-abstracted — eight steps where three named phases would do, with a [walkthrough](walkthrough.md) beneath expanding the interesting one. Bands are for when the steps genuinely all matter.

**Then wrap into bands**, the way a musical score wraps to a new system and repeats the staff labels:

```text
              ┌──────────────────────────────────────▶ band 1 of 2
              │ ┌──────────┐
     Spotify  │ │ /shows   │
              │ └────┬─────┘
              │ ---- ▼ ------------------------------
              │  ┌───────┐    ┌──────────┐
     Gateway  │  │ probe ├───▶│ step 2   ├──────────▶
              │  └───────┘    └────┬─────┘
              │ ------------------ ▼ ----------------
              │               ┌──────────┐
  l5 (MySQL)  │               │ show ids │
              │               └──────────┘
              └──────────────────────────────────────▶

              ┌──────────────────────────────────────▶ band 2 of 2
              │ ┌───────────────┐
     Spotify  │ │ batchEpisodes │
              │ └───────┬───────┘
              │ ------- ▼ ---------------------------
              │    ┌───────────┐    ┌──────────┐
     Gateway  │ ──▶│ match     ├───▶│ step 3   │
              │    └───────────┘    └──────────┘
              │ -------------------------------------
              │
  l5 (MySQL)  │
              │
              └──────────────────────────────────────▶
```

| Rule | Why |
|---|---|
| Every band repeats the **full lane set, in the same order** — including lanes idle in that band | an omitted lane reads as a lane that ended |
| The axis carries `▶` at the right edge of a continuing band, and `──▶` at the left edge of the next | the join is stated, not inferred |
| `band n of m` on the opening line | a reader scrolling a README cannot otherwise tell how much is left |
| Lane titles keep the same field width across every band | the eye lands in the same column throughout |

## Why not columns for lanes

Lanes-as-columns puts the unbounded dimension on the unbounded axis, which removes the width problem outright. It is rejected anyway: it gives the workspace two contradictory reading directions, so every swimlane has to be decoded before it can be read. Bands cost a repeated header; columns cost consistency across every other form here.
