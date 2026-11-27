# Journal-only sourcing

Articles explain concepts. Journals retain evidence, source references,
attribution, quotations, comparisons between sources and research chronology.
Journal entries identify the articles they inform; articles do not link back
to journals or carry provenance metadata. Keep uncertainty and limitations in
the article without narrating who said what. Read [the authoring guidance](AUTHORING.md) for the editorial
self-check performed by the writing agent before publishing. There is no
separate reviewer, approval queue or reason to leave a successful change staged.
Raw search evidence is appended directly to the published journal; it does not
pass through article review or batch staging.

## Commands

Run from the owning frame:

```sh
make editorial-check
make editorial-check CHANGE=stable-change-id
make publish CHANGE=stable-change-id
make lint
```

Without `CHANGE`, the check reads published articles. With `CHANGE`, it checks
the proposed graph: published articles overlaid with complete replacements in
`wiki/.drafts/<change>/pages/`. Journal-only drafts are supported. Index and log
are engine-owned and excluded. The checker never writes. Failures print file
paths, line numbers and reasons and return a nonzero status. Missing files,
unreadable directories and invalid change identifiers fail explicitly.

`publish` runs the check before the shared publisher. `lint` runs structural
validation and the editorial check against published content. Use these frame
targets; the shared engine deliberately accepts ordinary Markdown and does
not enforce this frame's authoring conventions. `GRAPH_ROOT` is supplied by the
frame Makefile; `CHANGE` is an optional environment input to `editorial.mjs`.
No prompts, credentials, network or model calls are used by the checker.

The mechanical check rejects provenance properties, dated journal wikilinks,
Markdown links into journals, HTTP(S) references, footnotes, common source
section headings and explicit attribution phrases such as "the author's" or
"from the playbook". Inline and fenced code examples are excluded. These are
recognisable markers, not a semantic classifier: unusual phrasing, disguised
references and document summaries still require manual editorial review.
An operational incident playbook or open source component is not itself a
source attribution. Do not remove meaningful subject vocabulary to satisfy
a superficial keyword check.

Verify changes manually with an isolated temporary graph. Exercise a clean concept, provenance in an article, the same provenance in a journal, a proposed replacement and a rejected publication. Existing Graphwiki frames retain their local editorial tools and viewer configuration.
