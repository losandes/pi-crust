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

## Context

React provides state management tools that work well within a component, but when state needs to be shared among multiple components, the build-in solutions in React are less than compelling, often resulting in what developers refer to as prop-drilling or spaghetti.

To choose a state manager, a team of 3 developers spent approximately 1 person-week building prototypes for the purposes of evaluation. The following state managers were evaluated as part of this decision:

- Jotai
- Nanostores
- Recoil
- Redux Toolkit (RTK)
- Zustand

Zustand emerged as a front-runner due to its simplicity, flexibility, and ability to avoid tight coupling. Its minimal boilerplate and straightforward implementation also align well with budget considerations and the 1/10/100 rule.

### Detailed comparison

#### Jotai

Similar benefits to Recoil, but its intrinsic design around hooks may enforce tighter coupling, which we explicitly aim to avoid. Was broken by React 18.2 release, indicating a misunderstanding of react or it's release plans.

- [Snyk Package Health](https://snyk.io/advisor/npm-package/jotai): 97 / 100
- **Security**: No known security issues
- **Popularity**: Key ecosystem project
- **Maintenance**: Healthy, however it was broken by React 18.2 release, indicating a misunderstanding of react or it's release plans.
- **Community**: Active
- **Complexity**: Simple-to-Moderate
- **Boilerplate**: Minimal
- **Type of Store**: Atomic state (according to their marketing materials, which may not be accurate)
- **Type of Coupling**: Hook-centric
- **Budgeting**: $$
- **1/10/100**: The atomic nature allows for isolated changes, but the tight coupling may mean design errors could propagate in component hierarchies

#### Nanostores

Its minimalism can be both an advantage and a drawback. It provides great flexibility (e.g. works with Svelte, Angular, etc.) but lacks some of the guidance and structure that the other libraries offer because it isn't built to handle React's inherent complexity. Was broken by React 18.2 release, indicating a misunderstanding of react or it's release plans.

- [Snyk Package Health](https://snyk.io/advisor/npm-package/nanostores): 80 / 100
- [Snyk Package Health nanostores/react](https://snyk.io/advisor/npm-package/@nanostores/react): 78 / 100
- **Security**: No known security issues
- **Popularity**: Influential project
- **Maintenance**: Sustainable, however it was broken by React 18.2 release, indicating a misunderstanding of react or it's release plans.
- **Community**: Sustainable
- **Complexity**: Very Simple
- **Boilerplate**: Very minimal
- **Performance**: Fast and should scale indefinitely
- **Type of Store**: Atomic state
- **Type of Coupling**: Non-opinionated
- **Budgeting**: $$$ (may require us to build features around it)
- **1/10/100**: Mostly controlled by us

#### Recoil

This abandoned project introduces risk via a global store (coupling, collisions) make this a poor choice. Requires careful structuring by developers with special expertise in recoil to avoid pitfalls.

- [Snyk Package Health](https://snyk.io/advisor/npm-package/recoil): 70 / 100
- **Security**: No known security issues
- **Popularity**: Influential project
- **Maintenance**: _Inactive / Abandoned_
- **Community**: Active
- **Complexity**: Very Complex because of a global state that requires elaborate designs to decouple
- **Boilerplate**: Moderate-to-High
- **Performance**: Not scalable
- **Type of Store**: Global Store. Recoil is marketed as being an atomic state library, however it is actually a global store. There are elaborate schemes to avoid this that appear to be designed less optimally than React's own useContext.
- **Type of Coupling**: Hook-Centric OR Selectors. Selectors reinvent hooks so you can write less-hookish hooks. In practice, selectors appear to yield rabbit holes in project organization.
- **Budgeting**: $$$$ We lost close to a person-month worth of effort debugging issues that were caused by Recoil's global state architecture.
- **1/10/100**: Errors in design could be costly due to Recoil's broad scope and the global nature of the state.
- **IMPORTANT DISQUALIFIER**: Webiny uses Recoil. Recoil has a global state store and isn't actually atomic, although it's marketed as being so. Webiny uses snapshots. Because they use snapshots and Recoil uses global state, if we use Recoil, our code can be broken by Webiny at any time.

#### Redux Toolkit (RTK):

Redux Toolkit (RTK): High levels of boilerplate code and risk introduced by a global store (coupling, collisions) make this a poor choice. Requires careful structuring by developers with special expertise in redux _and_ redux toolkit to avoid pitfalls. Was broken by React 18.2 release, indicating a misunderstanding of react or it's release plans.

- [Snyk Package Health](https://snyk.io/advisor/npm-package/@reduxjs/toolkit): 95 / 100
- **Security**: No known security issues
- **Popularity**: Key ecosystem project
- **Maintenance**: Healthy, however it was broken by React 18.2 release, indicating a misunderstanding of react or it's release plans.
- **Community**: Active
- **Complexity**: Very Complex. RTK is just an interface for Redux. All of the complexity of Redux needs to be understood in addition to the abstraction layer that RTK provides.
- **Boilerplate**: High. Significant boilerplate required, although less boilerplate code is necessary when compared to vanilla Redux.
- **Performance**: Fast, but not scalable because of it's share state
- **Type of Store**: Global Store. RTK is marketed as being an atomic state library, however it is just a wrapper of Redux' global store.
- **Type of Coupling**: Hook-centric
- **Budgeting**: $$$$ The extreme complexity of this lib will burn money at a time that will be out of our control
- **1/10/100**: Errors in design could be costly due to RTK's broad scope and the global nature of the state.

#### Zustand

Offers a balance of simplicity, maintainability, flexibility, and robustness making it an attractive choice.

- [Snyk Package Health](https://snyk.io/advisor/npm-package/zustand): 97 / 100
- **Security**: No known security issues
- **Popularity**: Key ecosystem project
- **Maintenance**: Healthy
- **Community**: Active
- **Complexity**: Simple-to-Moderate
- **Boilerplate**: Minimal
- **Performance**: Fast and will scale indefinitely
- **Type of Store**: Atomic State
- **Type of Coupling**: We control coupling. Can be used with and without hooks.
- **Budgeting**: $ (full featured, easy to use, evidence of strong backwards+forwards compatibility)
- **1/10/100**: Given its simplicity, design-time errors are less likely to snowball into bigger post-release problems

## Consequences

- We have to refactor our own usage of Recoil out of the app (caused by conflicts with Webiny also using Recoil, not this decision)
- If we don't refactor, the app will continue to experience instability each time we upgrade webiny
- Choosing a package manager is a long-term decision. We will not likely revisit this decision any time soon. That's because changing state managers is an expensive task that isn't typically perceived by end users (aka the decision is typically more aimed at COB than UX)
- A concern we have at this stage, is that we may need to _also_ use recoil in certain circumstances, like where we're extending something webiny. The _if and when_ of that is yet to be determined.
- This decision affects all front-end developers.
