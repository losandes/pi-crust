# Explaining project-state to a developer

Answer from these conventions. Do not invent a parallel workflow, and do not make the developer understand the implementation before they can use it.

## The mental model

> **Sources → project-state artifact → context-mode index → relevant context in future sessions**

Sources are evidence about a body of work: Pi session exports, notes, Slack conversations, GitHub issues and PRs, design documents, another developer's artifact, or anything else useful.

The artifact distils them into small durable knowledge — current state, decisions and their rationale, discoveries, problems, open questions, rejected approaches, next steps.

Artifacts are committed under year, project, and owner namespaces so they are shared without becoming collaboratively edited documents.

context-mode then indexes artifacts, so a future session can retrieve the relevant sections without loading the original sources.

Division of responsibility:

| Layer | Responsibility |
|---|---|
| Source material | Primary evidence and history |
| Project-state artifact | Small, curated, durable knowledge |
| Git | Distribution between developers |
| context-mode | Indexing and selective retrieval |
| Pi session | Temporary working context for current work |

The artifact is durable; the index is a retrieval layer that can be rebuilt from it. context-mode does not replace project-state artifacts.

## The convention, briefly

```text
.context/project-state/<year>/<project>/<owner>/<artifact>.md
```

> **Year = organizational scope → Project = relevance scope → Owner = provenance → Artifact = knowledge scope**

```text
.context/project-state/2026/authorization/developer-a/resource-permissions.md
.context/project-state/2026/authorization/developer-b/integration.md
```

One owner per artifact. Read and index each other's freely; do not edit them. On a handoff, the receiving developer uses the previous developer's artifact as a source for their own. Year is a default discovery scope, not a knowledge boundary — reach into prior years when their decisions or discoveries bear on current work.

Full detail in [convention.md](convention.md).

## Invocation

Explicit:

```text
Use the project-state skill.

Sources:
- ~/sessions/auth-monday.jsonl
- ~/sessions/auth-tuesday.jsonl
- ~/notes/auth.md

Artifact:
.context/project-state/2026/authorization/developer-a/resource-permissions.md
```

Mixed forms, including material already in the conversation:

```text
Update my authorization project state using:
- the Slack conversation I pasted above
- PR #184
- these two Pi session exports

Artifact:
.context/project-state/2026/authorization/developer-a/resource-permissions.md
```

A handoff:

```text
Use:
- .context/project-state/2026/authorization/developer-a/resource-permissions.md
- PR #201
- the notes I pasted above

to create my project-state artifact at:

.context/project-state/2026/authorization/developer-b/resource-permissions.md
```

No rigid format is required. All of these are complete enough to act on, once year, project, owner, and artifact are settled:

- *Add these Pi sessions to my authorization project state.*
- *Update my video context with these notes.*
- *Create a project-state artifact from these three sessions.*
- *Incorporate this Slack conversation into my existing adstack context.*
- *Update my project state using this PR and the discussion around it.*
- *I'm taking over this project from another developer. Use their project-state artifact and these GitHub issues to create mine.*
- *Bring the relevant knowledge from last year's authorization work into my current artifact.*

Ask only for what is missing. Normally that is: which sources count, which year and project, who owns it, and which artifact to create or update. If the developer names the work but not the path, explain the convention and help choose a path.

## Questions developers ask

| Question | Answer from |
|---|---|
| How does project-state work? What should and shouldn't I put in it? | The mental model above; [extraction.md](extraction.md) |
| Where is my project state stored? What artifacts exist? | [convention.md](convention.md), discovery section |
| Does anyone have context on this? Is there anything from last year? | Progressive discovery — filenames and metadata first |
| Can I use a session export / notes / Slack / an issue or PR? All of them? | Yes to each, and yes to combining them |
| How do I update an existing artifact? | Read it first, then reconcile — never append a source summary |
| How do I hand work off, or pick someone else's up? | [convention.md](convention.md), handoffs |
| Should I edit someone else's artifact? | No. Use it as a source for your own |
| How should I name an artifact? When do I create a new one? | Semantic names; split on independent scope or lifecycle |
| When should knowledge move into a new year's artifact? | When current work depends on it — by synthesis, not copying |
| How does this relate to context-mode? How do I get this into a new session? | The table above; index the artifact, as a separate step |

## Keep usage simple

If a developer supplies three session exports and says "these are all about the video pipeline, save what matters so I can pick this up later", determine the year, project, owner, and artifact, then create or update it.

Do not ask them to classify decisions, discoveries, or active work themselves. That synthesis is the purpose of this skill.
