---
Context: All apps
---

# Format markdown

## Status

accepted

## Decision

Break a markdown line only where the document itself breaks: between blocks, between list items, between table rows. A paragraph is one line, however long, and the reader's editor wraps it.

Never break a line to fit a column. Two spellings of the same mistake are banned with it: a trailing double space and a trailing backslash both force a break inside a paragraph. Content that genuinely needs a break is two blocks.

Sentence-per-line is also rejected, though it is defensible elsewhere. One convention per repository, and this one is paragraphs.

Everything mechanical beyond wrapping follows markdownlint, whose rule identifiers are used below so the reference stays findable. The subset in force:

| Rule                                                                  | Identifier   |
| --------------------------------------------------------------------- | ------------ |
| A blank line above and below every heading                            | MD022        |
| One space after the heading marker, and no more                       | MD018, MD019 |
| Heading levels increment by one                                       | MD001        |
| A blank line above and below every list                               | MD032        |
| A blank line above and below every fenced block                       | MD031        |
| A language on every opening fence, `text` when there is no better one | MD040        |
| One space after a list marker                                         | MD030        |
| A hyphen for unordered list items                                     | MD004        |
| Nested list items indented in multiples of two spaces                 | MD007        |
| No trailing whitespace                                                | MD009        |
| No hard tabs                                                          | MD010        |
| No stacked blank lines                                                | MD012        |
| No bare URLs                                                          | MD034        |
| No empty links                                                        | MD042        |
| Double asterisks for strong emphasis                                  | MD050        |
| A leading and trailing pipe on every table row                        | MD055        |
| Exactly one newline at end of file                                    | MD047        |

MD013, the line-length rule, is rejected. It is the rule that produces the habit this record exists to undo.

One rule has no markdownlint equivalent and is enforced by a custom rule instead: **a table's columns are padded so that its pipes line up in the source.** Cells are separated from the pipes by one space and padded on the right to the width of the widest cell in the column, and the separator row is widened to match. Alignment colons are preserved; cell content stays left-aligned in every column, because the rendered output is identical either way and content pushed away from its pipe is harder to read in the source.

A table whose second line is not a separator row is not a table. Pipes in prose are left alone.

## Context

Prose has been written in paragraphs for centuries, and every editor, reviewer, and rendering surface already knows how to wrap one. Hard-wrapping at a fixed column is a convention inherited from fixed-width terminals and mail clients that could not wrap for themselves, and it survives in tooling defaults long after the constraint disappeared.

The cost is paid on every edit. A column-wrapped paragraph has breaks at positions that mean nothing, so changing one word pushes text across the following lines and the author must re-wrap by hand. The diff then shows several changed lines where one word changed, and a reviewer cannot see which. Two people editing different sentences of the same paragraph collide on lines neither of them meant to touch. None of this is true of a paragraph on one line: the edit touches the sentence, and the diff says so at word level in every surface that renders one.

Table padding is the one rule here that costs what hard-wrapping costs, and it is adopted anyway. Widening one cell re-pads its whole column, so a one-word edit produces a diff across every row. The difference is scale and frequency: a table is bounded where a document is not, its rows are edited far less often than its prose, and the alternative is a source table nobody can read without rendering it. An unpadded table is also the only construct here whose source actively misleads — columns appear to be in an order the pipes do not support. Because the cost is real, the padding is produced by a script rather than by hand; a hand-padded table drifts on the first edit, and a reviewer cannot tell a deliberate column from a miscounted one.

A linter is the obvious way to enforce the remainder, but running a general markdown linter over prose produces more noise than signal. Most of its catalogue is stylistic preference. Its rules remain the best available statement of what is mechanically wrong with a markdown file, so they are adopted as the reference while a narrow subset is enforced deterministically.

## Consequences

Documents written before this record are wrapped at a column, and they stay that way until touched for another reason. Reflowing a file is a change to every line in it, which buries the change that prompted it, so a document is reflowed as its own commit or not at all.

Writing agents are the main source of violations, because wrapping output at a fixed width is a strong default in the models and in the tools that edit files. Enforcement therefore has to be mechanical rather than a note in a style guide.

Generated files are a carve-out: they follow whatever generated them and are not reformatted by hand. Content vendored from elsewhere is a second carve-out, keeping its original formatting so it can be re-synced with its upstream without a conflict on every line. A team's own writing is never vendored content, whatever directory it sits in.

Fenced blocks and ASCII diagrams are not prose and are unaffected by the wrapping rule; the contents of a fence are governed by whatever language the fence declares, including a table drawn inside one. A table row is a block boundary and is never joined to another line, but its interior spacing is governed, which is the one way tables are not simply exempt.

Inline HTML comments are exempt from the wrapping rule, because a comment is not rendered and its line breaks cost a reader nothing.
