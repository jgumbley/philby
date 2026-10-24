# Philby development

## Principles (Prime directives)

- YAGNI — build only what is needed.
- DRY — if something exists, reuse it.
- KISS — keep it straightforward; no optional branches or toggles.
- No fallbacks — they hide failures; let issues surface immediately.

No code comments. Use deterministic providers, temporary stores and isolated tmux servers in tests.

Read `Makefile` and `README.md`. Use `make help` and `make digest` for discovery, and `make check` and `make test` for application changes. Run the affected module's checks and tests for module changes; `make check-all test-all` covers everything.


Keep automated tests focused on Philby core behavior. Do not add tests for pane-specific agent responsibilities or workflows. Verify those manually through their Make targets.

Preserve one application process and Durable store per slug. Never replace a saved conversation, import old sessions automatically or mark unsafe tools replay-safe. Keep memory separate from transcript compaction. A receiving pane is the pane identified by the message's destination slug. Persist its mailbox record before acknowledging acceptance and preserve stable request IDs. Pane types are creation recipes; reopening preserves edited files and saved work.

Execute task-specific operations through named targets in `panes/<slug>/Makefile` or `shared/Makefile`. Check both for existing capabilities before building a tool. Use shared `research` for tactical web lookups about unfamiliar devices, libraries, protocols or existing implementations. If a pane-specific capability is missing, build the smallest reusable pane tool first, document its interface, then run and verify it through Make, including initial diagnostics. Native Pi tools remain direct for standard coding work and tool construction; native bash does not exempt operational commands. Reuse targets and repair or report failures without bypassing Make. Preserve prompt-file/stdin handling and surface command failures. Application development requires explicit direction.

Never expose or commit credentials, `.env`, SQLite state or conversation logs. Cleanup retains state and tools. Do not modify the reference repository.
