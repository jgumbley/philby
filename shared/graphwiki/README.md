# Philby graphwiki engine

Philby's owned Rust engine for small Logseq Markdown file graphs. It publishes
complete page and journal replacements, builds a deterministic article
catalogue, searches documents, and checks graph structure. Research content and
authoring conventions belong to each consuming wiki. There is no model
invocation, downloader, database, or background service.

## Development

```sh
make
make ci
make check
make fmt
make complexity
make ci release
make doc
make coverage
make digest
make ingest
```

Requires Rust, Cargo, rustfmt, Clippy, Make, Bash, and a native linker. The
`wiki-*` adapter targets also require Node and util-linux `flock`. `make` and
`make ci` check formatting, run strict Clippy and all tests, and build the debug
binary. Formatting checks do not change files; `make fmt` applies formatting.
`make compile` is an incremental locked build without tests. `make release`
performs a locked release build; `make ci release` validates it first. `make run`
runs the validated binary and prints usage. No terminal UI is included.

Clippy limits cognitive complexity to 9, functions to four arguments and fifty
lines, and applies the other thresholds in `.clippy.toml`. Mozilla's
rust-code-analysis checks cyclomatic complexity at most **5 per Rust function**,
including tests. No code comments. The suite enforces this rule.
These gates run in `make ci`; `make complexity` runs the
analyzer independently. Tests use temporary graphs and need no parent wiki.

Keep `Cargo.lock`: the analyzer's Rust grammar has a broad dependency range,
and the inherited lockfile deliberately resolves its parser to tree-sitter
0.20.9. The analyzer is a development dependency and is not linked into the
wiki binary. Coverage requires cargo-llvm-cov and llvm-tools-preview.

`make digest` prints this directory's instructions and source. `make ingest`
copies exactly that digest using `wl-copy`, requiring an active Wayland
clipboard. It does not import research sources. A failed digest leaves the
clipboard unchanged. The shared `common.mk` can also serve a consuming wiki;
set its `DIGEST_FILES` and `DIGEST_DIRS` before including it.

## Interfaces and integration

The CLI accepts an operation, a graph root, and one argument:

```sh
cargo run --locked -- context /absolute/path/to/wiki "literal search phrase"
cargo run --locked -- publish /absolute/path/to/wiki change-name
cargo run --locked -- index /absolute/path/to/wiki ""
cargo run --locked -- lint /absolute/path/to/wiki ""
```

Without arguments or with `--help`, the binary prints usage. Successful output
goes to stdout; errors go to stderr with a nonzero exit code. The Rust library
exports `execute(operation: &str, root: &Path, argument: &str) -> Result<String>`,
where `Result<T>` uses a `String` error. The graph root must already exist.

The module owns `wiki-context`, `wiki-publish`, `wiki-index`, and `wiki-lint`.
From the Philby root:

```sh
make -f shared/graphwiki/Makefile wiki-context GRAPH_ROOT=path/to/wiki PROMPT_FILE=query.txt
make -f shared/graphwiki/Makefile wiki-publish GRAPH_ROOT=path/to/wiki CHANGE=change-name
make -f shared/graphwiki/Makefile wiki-index GRAPH_ROOT=path/to/wiki
make -f shared/graphwiki/Makefile wiki-lint GRAPH_ROOT=path/to/wiki
```

The same targets remain available through `make -f shared/Makefile`. Context
accepts `PROMPT_FILE`, `prompt`, or stdin; publish accepts `CHANGE`. Relative
paths resolve from the caller's working directory; use `-f` to preserve that
directory. Commands serialize per canonical graph root with `flock`; external
editors must still respect the single-writer rule. Shared `wiki-check` and
`wiki-test` delegate to this module's `check` and `ci` targets. The module's
`lint` target runs Clippy; `wiki-lint` checks a graph.

The local `wiki.mjs` adapter dispatches to this directory's `make invoke`, supplying
`OPERATION`, `GRAPH_ROOT`, and `ARGUMENT` in the environment. `invoke` uses
`cargo run --locked --quiet`, so Cargo chooses the binary location and honours
`CARGO_TARGET_DIR`. It builds incrementally without running tests or formatters.
There is no separate engine installation, sibling dependency, submodule, or
engine path override. `tests/fixtures/consumer.mk` exercises the Make interface
in an isolated temporary graph; it is not an installation requirement.

The graph layout is `pages/` for articles, optional `journals/` for daily notes,
`.drafts/` for batches, and `.graphwiki/` for publication state. `pages/index.md`
and `pages/log.md` are reserved for the engine. Context and validation include
journals; the catalogue lists articles only. Logseq configuration and asset
organisation remain consumer concerns. Use `yyyy-MM-dd` for both Logseq's
`:journal/page-title-format` and `:journal/file-name-format` so journal titles
and filenames agree with the engine's ISO date convention.

## Pages and citations

Ordinary Markdown pages are valid without properties or citations. The initial
Logseq property block is optional. A nonblank `title` supplies the page title;
otherwise its filename stem is used, including ISO journal dates. `description`,
`type`, `original`, and `sources` are optional; arbitrary properties and existing
block IDs survive publication unchanged. Duplicate properties and duplicate
page titles are errors. Title comparison is case-insensitive.

Citations may be prose, book references, URLs, local links, or wiki links.
The engine does not fetch references, copy originals, or check whether cited
files exist. Resolvable wikilinks in `sources` add their pages to context
results regardless of page type. Unresolved wikilinks produce lint and publish
warnings without blocking publication or search. Standalone pages are valid.

`context` performs a case-insensitive literal search over article and journal
filenames and contents, returning whole matching documents plus resolvable
`sources` documents, deduplicated and sorted by their directory and filename stem.
Index and log are excluded from matches.
An empty query fails; no matches returns a successful empty-result message.
`index` creates one catalogue containing all non-system articles in filename
order, using titles and optional descriptions. `lint` checks without writing.

Markdown links are parsed with pulldown-cmark and basic wikilinks enabled.
Inline and fenced code do not create references. This is a small authoring
subset: aliases, namespace filename encoding, nested page references, macros,
and block-reference resolution are outside its scope. Graph checks do not
establish historical accuracy or citation quality.

## Publishing and recovery

Prepare `.drafts/change-name/summary.txt` with a nonempty explanation, and put
complete replacements in `.drafts/change-name/pages/` and/or
`.drafts/change-name/journals/`. Each directory contains only flat Markdown
files; a batch must contain at least one document. Journal-only batches are
valid and create `journals/` when necessary. Journal filenames must be real
calendar dates in `YYYY-MM-DD.md` format. Article filenames and change
identifiers use lowercase letters, digits, and single hyphen separators. Index
and log cannot be published as draft pages, and no document may claim either
reserved title. Titles must be unique across articles and journals. Publishing
adds or replaces documents; it does not delete or rename them.

Publishing validates the complete proposed graph before writing and preserves
the exact Markdown bytes. It rejects unsafe write destinations and symlinks.
The batch summary, document identities and bytes are fingerprinted with SHA-256.
Existing article-only fingerprints remain unchanged; journal identities include
their directory so moving a draft changes its fingerprint. A pending
receipt stores the change identifier, fingerprint, and timestamp. Each file is
replaced through a synced temporary file in its parent directory; the index is
regenerated and the log appended once before a completed receipt is written.

A failed publication can leave some files replaced because atomicity is per
file. Keep the original draft unchanged and retry its command. Other graph
operations refuse to run while a publication is pending. Replaying a completed
batch is a no-op even if later batches changed its pages. Reusing an identifier
with different draft bytes fails. Drafts are retained. Keep `.graphwiki/` with
the graph when backing it up: it contains publication history and recovery state.

Only one writer may modify the graph at a time, including Logseq edits and
synchronisation software. There are no concurrent merges or graph-wide
transactions. Original research files are never modified by the engine.

See [AGENTS.md](AGENTS.md) for development rules and [DECISIONS.md](DECISIONS.md)
for extraction provenance and the reasons behind these conventions.
