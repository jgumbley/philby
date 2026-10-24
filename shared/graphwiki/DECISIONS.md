# Graphwiki ownership and design decisions

## Source and ownership

On 2026-10-18 the current local `graphwiki-engine` source was copied into
Philby's `shared/graphwiki/` as owned source. The source workspace was
uncommitted; it was left unchanged. No nested Git history, build outputs,
caches, remote workflow configuration, wiki content, or conversation state was
imported. Philby builds and maintains this copy directly, without a sibling
dependency, submodule, engine path override, or automatic source update.

The engine had originally been extracted on 2026-09-27 from the local
`eaadwig/graphwiki` working tree, whose committed baseline was
`e0e190cbdab28c97973153ba800ccbac1391ce5f`. The extraction included then-current
source-path changes and subsequently removed restrictions requiring accessible
local source files. The original research repository remains independent.

## Content and references

Each wiki owns its subject matter and authoring conventions. Ordinary Markdown
is valid without mandatory types, descriptions, or citations. References may
identify web material, books, archives, local documents, or other wiki pages.
The engine does not download evidence or require duplicate originals or
artificial source pages.

Optional `sources` wikilinks include resolvable referenced pages in context
results. Unresolved wikilinks produce structural warnings; standalone pages
and missing citations remain valid. Citation quality and factual accuracy are
editorial responsibilities of the writing pane.

## Publication and integration

The imported implementation retains its Rust library API and three-argument
CLI, exact Markdown preservation, complete-page draft batches, safe write
destinations, per-file atomic replacement, and recovery receipts. Publication
does not rename, delete, concurrently merge, or transact across a whole graph.
Keep drafts unchanged when retrying a stable change identifier, and retain
`.graphwiki/` with the graph's backups.

One pane owns publication to a graph. Shared Philby commands serialize per
canonical graph path. External editors and synchronisation software must obey
the same single-writer contract. The pane's Durable conversation and working
memory remain separate from the Markdown graph.

The Make interface builds incrementally with locked Cargo dependencies and
honours `CARGO_TARGET_DIR`. The imported consumer Make fixture tests dispatch
in an isolated temporary graph. It does not require a separate engine checkout.

## Engineering constraints

No code comments. Preserve strict Clippy limits and the maximum cyclomatic complexity
of five for every Rust function, including tests. The Rust test suite enforces
the no-comments rule and complexity limits.

Keep the imported Cargo lockfile. The analyzer's parser dependency must remain
at the locked tree-sitter 0.20.9 resolution. Engine validation uses temporary
graphs and never a user's published wiki. Builds and checks do not format or
alter source automatically.
