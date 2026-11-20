# Philby development

## Principles (Prime directives)

- YAGNI — build only what is needed.
- DRY — if something exists, reuse it.
- KISS — keep it straightforward; no optional branches or toggles.
- No fallbacks — they hide failures; let issues surface immediately.

No code comments. Use deterministic providers, temporary stores and isolated tmux servers in tests.

Read the Makefile and follow its delegated scripts for capability discovery; use `make digest` when needed. Agents can interpret targets directly. Do not add or maintain `make help` targets or duplicate target inventories, command usage or configuration in README files or frame notes: these copies drift. Use `make lint` and `make test` for application changes. `make test` covers everything and will always be run last.


Keep automated tests focused on Philby core behavior. Do not add tests for frame-specific agent responsibilities or workflows. Verify those manually through their Make targets.

Preserve one application process and Durable store per frame ID. Never replace a saved conversation, import old sessions automatically or mark unsafe tools replay-safe. Keep memory separate from transcript compaction. A receiving frame is the frame identified by the message's destination frame ID. Persist its mailbox record before acknowledging acceptance and preserve stable request IDs. Frame types are creation recipes; reopening preserves edited files and saved work.

Execute task-specific operations through named targets in `frames/<id>/Makefile` or `shared/Makefile`. Check both for existing capabilities before building a tool. If a frame-specific capability is missing, build the smallest reusable frame tool first, express its interface in target names, variables and argument parsing, then run and verify it through Make, including initial diagnostics. Native Pi tools remain direct for standard coding work and tool construction; native bash does not exempt operational commands. Reuse targets and repair or report failures without bypassing Make. Preserve prompt-file/stdin handling and surface command failures. Application development requires explicit direction.

Never expose or commit credentials, `.env`, SQLite state or conversation logs. Cleanup retains state and tools. Do not modify the reference repository.
