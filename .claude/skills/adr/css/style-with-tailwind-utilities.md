---
Context: CSS styling with Tailwind CSS and runtime themes
---

# Style with Tailwind utilities

## Status

accepted

## Decision

Author components with Tailwind CSS v4 utilities and an existing CSS-variable theme. Install Tailwind CSS and its build plugin at the same literal version, and keep them on the same release when upgrading.

### Theme and class composition

Bridge established theme roles with `@theme inline` when their values reference runtime-swapped CSS variables. Do not use plain `@theme` for a `var(...)` alias: generated utilities must reference the semantic variable at the element where they apply, rather than an intermediate variable resolved where it was defined.

```css
@theme inline {
  --color-ok: var(--ok);
  --font-sans: var(--sans);
}
```

Use existing theme roles, not literal colours in a class or inline style. Do not add a colour name or palette rung to translate a stylesheet. Apply opacity with utility modifiers such as `bg-ok/10`, `border-violet/45` and `bg-fail/16`; Tailwind CSS v4 compiles these to `color-mix(...)` against the bridged colour.

Select a variant through a literal map of complete class names. Do not interpolate fragments of a class name: Tailwind's source scanner needs to see the complete candidate. Compose conditional classes with a small class-name helper; runtime conflict resolution is not a substitute for selecting a coherent variant.

```ts
const tones = {
  success: 'text-ok bg-ok/10',
  failure: 'text-fail bg-fail/16',
} as const
```

A component is either fully authored with utilities or fully authored with its stylesheet, never both. Migrate a component as a unit rather than retaining a stylesheet for selected declarations. Global theme tokens and keyframes remain shared styling infrastructure. Rendered markdown is styled by one shared component written with Tailwind descendant variants on its root element, rather than global rendered-prose rules.

Application-owned keyframes are global and uniquely named with an application-specific prefix. CSS Modules must reference them with `global(...)` so the compiler does not rewrite a reference to a local name with no matching keyframes. Do not use Tailwind's `animate-pulse` or `animate-spin` utilities; their framework-owned keyframe names must not select an application animation accidentally.

Keep preflight enabled. Reconcile defaults that existing rendered prose relies on, including explicit unordered-list bullets and ordered-list numbering, without modifying the markdown renderer.

### Responsive layout

Author layout mobile-first in Tailwind's own sense: the unprefixed utility is the small-screen case, and min-width breakpoint variants layer on larger layouts. Do not use a breakpoint-prefixed utility to style a phone; a prefix applies at that breakpoint and above, never below it.

```html
<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 xl:grid-cols-3">
  <article>Content</article>
</div>
```

Use only Tailwind's default breakpoint scale. Do not add a breakpoint to the theme. A genuine one-off uses an arbitrary `min-[...]` or `max-[...]` variant on the single element that needs it, with a comment explaining why that width is required.

A component whose parent determines its width, such as a grid or flex cell, panel, drawer or column, adapts with container queries rather than viewport breakpoints. Mark the parent with `@container` and apply child variants such as `@sm` and `@max-md`. The viewport does not establish the space available inside that parent.

```html
<div class="@container">
  <article class="flex flex-col gap-2 @md:flex-row @md:items-center">
    Content
  </article>
</div>
```

Use Tailwind's default scale for spacing, sizing and radii. An arbitrary value is permitted only for a genuine constraint with no corresponding scale step, not to reproduce a pixel value inherited from a previous design. Translate an inherited fixed pixel value to the nearest scale step, a breakpoint or a container query; the old stylesheet is not a reason to carry it across unchanged.

A container must not fix a height, width or column width for content whose length varies. Use intrinsic sizing, a minimum height or an aspect ratio as appropriate. A fixed budget combined with hidden overflow silently hides content that exceeds it.

```html
<article class="flex min-h-64 flex-col">
  Content
</article>
```

A region that scrolls its own overflow is exempt along the axis it scrolls. It may fix or cap its size on that axis, because content beyond the frame stays reachable by scrolling inside it and is not hidden.

```html
<section class="flex h-96 flex-col">
  <h2 class="shrink-0">Log</h2>
  <div class="min-h-0 flex-1 overflow-y-auto">Entries</div>
</section>
```

A control revealed on hover must also be revealed for a coarse pointer and keyboard focus. Use the corresponding pointer and focus variants so touch and keyboard users can reach the same control.

### Browser verification

Verify layout across the base tier below the first breakpoint, then `sm`, `md`, `lg`, `xl` and `2xl`, rather than inspecting only a desktop layout. Measure that the document's scroll width does not exceed its client width at each tier; visual inspection alone does not establish the absence of horizontal scrolling.

Refer to viewport widths by tier in specifications, records, components and tests, never by a literal number. A shared browser-test helper exposes the widths named by tier, reading the breakpoint widths from the theme's `--breakpoint-*` values. The base tier takes its width from a Playwright device descriptor for a small phone, not a hand-chosen number. Numeric viewport widths belong only inside that helper.

## Context

Tailwind's [theme documentation](https://tailwindcss.com/docs/theme#referencing-other-variables) shows that `inline` emits the referenced value directly into a utility. CSS custom properties resolve in the scope where they are defined; an additional alias can therefore resolve differently from the semantic variable at the utility's use site. Keeping the reference inline preserves the runtime theme boundary.

Tailwind's [source detection](https://tailwindcss.com/docs/detecting-classes-in-source-files) scans text rather than executing class-building code. Literal variant maps let the scanner discover every choice without a runtime merging dependency.

Tailwind's [responsive design](https://tailwindcss.com/docs/responsive-design) provides mobile-first min-width variants and container queries. Parent-sized components need the latter because their available width can change without the viewport changing. The default scales provide the translation target when replacing inherited pixel budgets.

Tailwind's [preflight](https://tailwindcss.com/docs/preflight) resets headings, lists and other browser defaults. Preserving an existing appearance requires checking those defaults, not assuming that unchanged component markup implies unchanged rendering.

A frame that keeps the newest entry of a growing log or conversation in view depends on a bounded height. Given only a minimum height it grows with its content, so it never overflows, has no scroll position to follow, and lengthens the page with every entry. The fixed-budget rule guards against content lost to clipped overflow; a region that scrolls its overflow loses none.

## Consequences

Theme switches repaint utility-styled elements without rebuilding CSS. Component migrations are reviewable as complete styling changes, while shared tokens and global animations retain their own lifecycle.

Literal maps require enumerating valid variants. Keeping the default scales means accepting their nearest suitable step rather than preserving every previous pixel value; exceptional constraints remain local and documented.

Browser verification depends on the same installed theme as the CSS compiler and on Playwright's device descriptors. A theme or framework upgrade must keep the tier helper aligned and repeat the layout measurements. Reconsider the default-scale restriction if a demonstrated constraint cannot be expressed by a local arbitrary variant or container query.
