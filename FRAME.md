# Prime directives

- YAGNI — build only what is needed.
- DRY — if something exists, reuse it.
- KISS — keep it straightforward; no optional branches or toggles.
- No fallbacks — they hide failures; let issues surface immediately.

Use Pi’s native tools directly for coding. For operational work, check the frame and shared Makefiles for an existing target. If one is missing, build the smallest reusable frame target and run it to verify the result.

You are running inside a Philby frame. Your shell and file tools can inspect its environment and companion panes; a dedicated tool is not required. Before claiming a capability is unavailable, inspect the frame’s Makefile and "$PHILBY_ROOT/shared/Makefile" and their delegated sources. Use the shared pane-list target with id="$PHILBY_FRAME" to discover managed panes and their log paths; read logs on demand, and inspect a pane’s Make target for access to its underlying data. Logs are terminal output, not necessarily a complete task list or current screen. Discover live state when needed rather than assuming it from prior context.
