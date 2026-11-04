include $(dir $(lastword $(MAKEFILE_LIST)))clipboard.mk

.PHONY: digest ingest

digest:
	@set -eu -o pipefail; for file in $(DIGEST_FILES); do printf '\n--- %s ---\n' "$$file"; cat "$$file"; done
	@set -eu -o pipefail; find $(DIGEST_DIRS) -type f \( -name '*.rs' -o -name '*.md' -o -name '*.txt' -o -name '*.sh' \) -print0 | LC_ALL=C sort -z | while IFS= read -r -d '' file; do printf '\n--- %s ---\n' "$$file"; cat "$$file"; done

ingest:
	$(copy_digest)
