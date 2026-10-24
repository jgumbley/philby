# Engine instructions

## Principles (Prime directives)

- YAGNI — build only what is needed.
- DRY — if something exists, reuse it.
- KISS — keep it straightforward; no optional branches or toggles.
- No fallbacks — they hide failures; let issues surface immediately.

This directory is Philby-owned Rust source for shared graph operations and their
build. Each wiki pane owns its research content and authoring conventions.

Leave changes uncommitted unless the user explicitly requests a commit.

- Read this Makefile and `common.mk`; use `make digest` to inspect the engine.
- Run builds, runtime commands, and tests through this Makefile. Reuse existing targets before adding one.
- Implement reusable wiki operations in Rust. Do not introduce Python, JavaScript, or shell implementations of wiki logic.
- No code comments.
- `make` and `make ci` check formatting without rewriting files, run strict Clippy and all tests, and build the debug binary. Use `make fmt` to apply formatting.
- Preserve inherited Clippy flags and thresholds, including cognitive complexity 9, four arguments, and fifty lines per function. Clippy also checks test targets.
- Keep cyclomatic complexity at most 5 per Rust function. `make complexity` runs the Rust-code-analysis gate, which also runs in the normal test/build/CI pipeline. Refactor instead of raising limits or adding exemptions.
- Keep the locked analyzer dependency resolution documented in the README.
- `make invoke` uses Cargo to incrementally build and run graph commands with explicit `OPERATION`, `GRAPH_ROOT`, and `ARGUMENT`; honour custom Cargo target directories. `make compile` builds without running tests or formatters.
- `make run` prints CLI usage after validation. `make release` retains the locked release build; use `make ci release` for a validated release.
- `make digest` prints engine source and instructions; `make ingest` copies that exact output to the clipboard. Clipboard tools are optional for graph operations.
- Keep parsing, graph operations, publishing, and filesystem handling shared across commands. Preserve exact Markdown bytes, arbitrary properties, and block IDs; never reserialize whole pages through a formatter.
- Accept ordinary Markdown with optional properties and citations. Do not impose research categories, mandatory citations, source-page types, or accessible local originals. Leave citation quality to the consuming wiki.
- Preserve safe destinations, reserved index/log pages, duplicate checks, receipts, retries, and single-writer operation. Publication replaces complete pages and does not implement deletion or renaming.
- Test publishing failures and recovery with temporary graphs, never a user's published wiki. Keep the Rust crate's tests self-contained.
- Use the source in this directory. Do not add sibling checkout dependencies, submodules, engine path overrides, or automatic source updates.
- Keep the implementation small, share logic, and return explicit errors.
