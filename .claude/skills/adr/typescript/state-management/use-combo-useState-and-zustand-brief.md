---
Context: Frontend apps
---

# Choose a state manager for React

## Status

accepted

## Decision (Matrix)

Use a combination of Tanstack Query, React's `useState` feature, and [Zustand](https://github.com/pmndrs/zustand), using the following decision matrix for when to use which:

```shell
.
└── Do we need state (or can we make do with tanstack cached query)?
    ├── yes
    │   └── Does the state exist only within the component?
    │       ├── yes
    │       │   └── Use React's `useState`
    │       └── no
    │           └── Should the state be unique per-component
    │               ├── yes # (often with forms)
    │               │   └── Use React's `useState`
    │               └── no  # (multiple components share same state)
    │                   └── Use React's Zustand
    └── no
```

_TODO: we may also have circumstances that cause us to use Recoil, such as when we're extending webiny... add that to the decision matrix when we understand the "when"_

## Usage

- Use the workspace's own `makeStore` helper unless the state needs to be persisted, then use zustand directly.
- Avoid creating unnecessary setter functions unless they contain significant business logic or complex state transformations
- Minimize state mutations and boilerplate
