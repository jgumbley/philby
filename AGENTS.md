# Philby development

Follow the [prime directives and Make working convention](FRAME.md). Change Philby only on explicit direction. Leave the reference repository untouched.

- Discover capabilities in Makefiles and their delegated scripts. Avoid help targets and copies of command usage or configuration in READMEs and frame notes.
- Run diagnostics through named Make targets. Preserve prompt-file and stdin support. Surface command failures. Write code without comments.
- Keep one process and Durable store per frame ID. Apply frame recipes only at creation. Preserve conversations, edited files and tools on reopen or cleanup. Keep memory separate from compaction. Never auto-import sessions or mark unsafe tools replay-safe.
- Keep credentials, `.env`, SQLite state and conversation logs private and out of Git.
- Test core behavior with deterministic providers, temporary stores and isolated tmux servers. Verify frame-specific workflows through their Make targets. For application changes, run `make lint`, then `make test` last.
