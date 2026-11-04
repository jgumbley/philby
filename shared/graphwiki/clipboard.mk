define copy_digest
	@set -eu -o pipefail; digest_file=$$(mktemp); trap 'rm -f "$$digest_file"' EXIT; \
	$(MAKE) --no-print-directory -s digest > "$$digest_file"; \
	case "$$(uname -s)" in \
		Darwin) pbcopy < "$$digest_file" ;; \
		Linux) \
			if [ -n "$${WAYLAND_DISPLAY:-}" ]; then \
				wl-copy < "$$digest_file"; \
			elif [ -n "$${DISPLAY:-}" ]; then \
				xclip -selection clipboard < "$$digest_file"; \
			else \
				printf '%s\n' 'Clipboard unavailable: Linux requires WAYLAND_DISPLAY or DISPLAY.' >&2; exit 1; \
			fi ;; \
		*) printf '%s\n' 'Clipboard copying supports macOS and Linux only.' >&2; exit 1 ;; \
	esac
endef
