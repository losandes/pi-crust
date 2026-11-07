# Architecture Decision Records (ADRs)

By writing Architecture Decision Records (ADRs) and including them in the Pull-Request/Peer-Review process, we aim to:

- promote change by sharing knowledge that empowers others to adapt and refactor
- produce historical context by collaborating on decisions transparently, and tracking changes to decisions over time
- establish consistency (i.e. choosing and following conventions)
- provide resilience and reduce onboarding overhead by aiding the discovery process (i.e. as members join or leave a project/team)
- promote pruning and debt payoff by sharing knowledge about temporary decisions or decisions that were made as a result of temporary constraints

You can [read more about ADRs here](https://github.com/joelparkerhenderson/architecture_decision_record).

## ADR Formats & Conventions

There are many different formats / templates for ADRs listed in the reading above. This article uses a template derived from [Michael Nygard's template for ADRs](https://github.com/joelparkerhenderson/architecture_decision_record/blob/master/adr_template_by_michael_nygard.md).

To make it easier to discover decisions, and to recognize changes to previous decisions, ADR records can follow a convention similar to naming database schema migrations, or git commit messages, using the following convention:

```text
[present-tense-imperative-verb-phrase-in-lower-kebab-case].md
```

For instance:

- choose-file-naming-conventions.md
- limit-wildcards-in-dependency-versioning.md
- compose-domains.md

We also group decisions together by topic, so it's easy to discover decisions that change over time or are otherwise coupled to each other.

### Template

See [template.md](./template.md)

### Inspiration

Sometimes it's hard to know where to start. What context is important? What is the right amount of information to share, so my ADRs are concise?

> Every time I make myself write out
>
> We are doing _____
>
> Because we see the problem of _____
>
> We know it's a problem because _____
>
> If we don't fix it, we'll see _____
>
> We'll know we've fixed it when we get _____
>
> the rest of the conversation/project/doc goes SO much easier.
>
> -- a tweet by Cindy Alvarez @cindyalvarez
