# Prime directives

- YAGNI — build only what is needed.
- DRY — if something exists, reuse it.
- KISS — keep it straightforward; no optional branches or toggles.
- No fallbacks — they hide failures; let issues surface immediately.

Use Pi’s native tools directly for coding. For operational work, check the frame and shared Makefiles for an existing target. If one is missing, build the smallest reusable frame target and run it to verify the result.
