.PHONY: digest ingest

digest:
	@for file in $(DIGEST_FILES); do printf '\n--- %s ---\n' "$$file"; cat "$$file"; done
	@find $(DIGEST_DIRS) -type f \( -name '*.rs' -o -name '*.md' -o -name '*.txt' -o -name '*.sh' \) -print0 | LC_ALL=C sort -z | while IFS= read -r -d '' file; do printf '\n--- %s ---\n' "$$file"; cat "$$file"; done

ingest:
	@digest_file=$$(mktemp); trap 'rm -f "$$digest_file"' EXIT; $(MAKE) --no-print-directory -s digest > "$$digest_file"; wl-copy < "$$digest_file"
