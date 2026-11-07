# Frontend review — judgement questions

Load only when the change touches `.tsx`, components, pages, hooks, or stores. The automated checks in Step 3 already cover the functional rules, the accessibility rules Biome can see, and parameter immutability. What follows is what they cannot see.

Rules live in [frontend-domains-design-brief.md](../../adr/project-organization/frontend-domains-design-brief.md), [1-domains-and-atomic-design.md](../../adr/project-organization/1-domains-and-atomic-design.md), [use-combo-useState-and-zustand-brief.md](../../adr/typescript/state-management/use-combo-useState-and-zustand-brief.md), and [functional-conventions.md](../../adr/typescript/functional-conventions.md). Quote those, not this file.

The functional record applies here in full. A component is a function: it takes props and returns a description of UI. Purity, immutability, and settlements are not backend concerns that stop at the render boundary.

## Atomic design

- Is the component at the right level? An atom that reaches for application state or fetches data is not an atom.
- Does a component do one thing? Presentation and orchestration in one file is the most common structural finding.
- Is complex state logic extracted to a hook, leaving the component declarative?
- Is this component new, or does the design system already have it? A second button is worse than an imperfect shared one.

## State

- Is local state local? `useState` for what one subtree owns, a store for what genuinely crosses boundaries.
- Is anything in a store that is derived rather than owned? Derived values are computed at read time, not stored and synchronised.
- Does a store hold server data that a query cache should own?
- Does an effect synchronise two pieces of state? That usually means one of them should not exist.

## Props and types

- Do props name what they mean, or how they are used — `isDisabled` rather than `flag`?
- Are props readonly? The typed check enforces this for exported functions; a component's props are its parameters.
- Does the component accept a whole domain object where it uses two fields? A narrow `Pick<>` makes it testable with an object literal.

## Accessibility

Biome's rules catch the mechanical cases — missing alt text, click handlers without keyboard equivalents, redundant roles, untyped buttons. They do not catch:

- Whether focus goes somewhere sensible after a dialog closes or a route changes
- Whether an error is announced to a screen reader, not only shown in red
- Whether a label describes its control, or merely exists
- Whether the reading order matches the visual order
- Whether colour alone carries meaning

## Rendering

- Is an expensive computation recomputed every render when it depends on nothing?
- Is a key an array index on a list whose order can change?
- Does an effect exist because the render needed it, or because state was modelled wrong?
