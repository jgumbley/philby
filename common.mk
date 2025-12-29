.DEFAULT_GOAL := .venv

.PHONY: .venv digest ingest clean agent-% update sync install-philby

ADB ?= adb
SERIAL ?=
SRC ?= ../warez
DEST ?=
PHILBY_EXPORT_FILES ?= AGENTS.md CLAUDE.md

# /*
# This is the core philby file that controls the agent interaction on behalf of the user.
# It is interpreted when any Make command is run
# And the AGENTS.md have been instructed to run Make
#
# Its important to check this file is upto date before proceeding too far, and prompt the user to do so.
#
# If the user prompts you, update this file using update target
# */
# `make update` syncs local `AGENTS.md` from https://github.com/jgumbley/philby

define success
	@printf '\033[32m\n'; \
	set -- 🦴 💉 🐶 😺 💊; \
	icon_idx=$$(( $$(od -An -N2 -tu2 /dev/urandom | tr -d ' ') % $$# + 1 )); \
	while [ $$icon_idx -gt 1 ]; do shift; icon_idx=$$((icon_idx - 1)); done; \
	icon=$$1; \
	parent_info=$$(ps -o ppid= -p $$$$ 2>/dev/null | tr -d ' '); \
	[ -n "$$parent_info" ] || parent_info="n/a"; \
	printf "%s > \033[33m%s\033[0m accomplished\n" "$$icon" "$(@)"; \
	printf "\033[90m{{{ %s | user=%s | host=%s | procid=%s | parentproc=%s }}}\033[0m\n\033[0m" "$$(date +%Y-%m-%d_%H:%M:%S)" "$$(whoami)" "$$(hostname)" "$$$$" "$$parent_info"
endef

.venv: .venv/

.venv/: requirements.txt
	uv venv .venv/
	uv pip install -r requirements.txt
	$(call success)

digest:
	@echo "=== Project Digest ==="
	@for file in $$(find . -path "./.uv-cache" -prune -o -type f \( -name "*.py" -o -name "*.md" -o -name "*.txt" -o -name "*.mk" -o -name "*.sh" -o -name "Makefile" \) -print | grep -v venv | grep -v __pycache__ | sort); do \
		echo ""; \
		echo "--- $$file ---"; \
		cat "$$file"; \
	done
	$(call success)

ingest:
	$(MAKE) digest | pbcopy
	$(call success)

update:
	@set -eu; \
	tmp=$$(mktemp); \
	trap 'rm -f "$$tmp"' EXIT; \
	curl -fsSL "https://raw.githubusercontent.com/jgumbley/philby/HEAD/AGENTS.md" -o "$$tmp"; \
	mv "$$tmp" AGENTS.md
	$(call success)

install-philby:
	@set -eu; \
	src_dir="$(CURDIR)/.philby"; \
	if [ ! -d "$$src_dir" ]; then \
		echo "Missing $$src_dir"; \
		exit 2; \
	fi; \
	for file in $(PHILBY_EXPORT_FILES); do \
		if [ ! -f "$$src_dir/$$file" ]; then \
			echo "Missing $$src_dir/$$file"; \
			exit 2; \
		fi; \
		cp "$$src_dir/$$file" "./$$file"; \
	done; \
	if [ ! -f .gitignore ]; then \
		printf '%s\n' '.philby/' > .gitignore; \
	elif ! grep -qxF '.philby/' .gitignore; then \
		printf '\n%s\n' '.philby/' >> .gitignore; \
	fi
	$(call success)

clean::
	rm -Rf .venv/
	$(call success)

# Run any make target inside a tmux agent pane so a human can type secrets
# locally while the agent watches output. Usage: make agent-<target>
agent-%:
	@cmd_target="$*"; \
	if [ -z "$$cmd_target" ]; then \
		echo "Usage: make agent-<target>"; exit 1; \
	fi; \
	bash ./pane.sh "agent-$$cmd_target" $(MAKE) "$$cmd_target"

sync:
	@set -eu; \
	adb_bin="$(ADB)"; \
	serial="$(SERIAL)"; \
	src="$(SRC)"; \
	dest="$(DEST)"; \
	adb_cmd() { \
		if [ -n "$$serial" ]; then "$$adb_bin" -s "$$serial" "$$@"; else "$$adb_bin" "$$@"; fi; \
	}; \
	if ! command -v "$$adb_bin" >/dev/null 2>&1; then \
		echo "Missing $$adb_bin (ADB). On Ubuntu: sudo apt-get install android-tools-adb"; \
		exit 2; \
	fi; \
	src="$${src%/}"; \
	if [ ! -d "$$src" ]; then \
		echo "Missing SRC directory: $$src"; \
		echo "Override with: make sync SRC=\"/path/to/roms\""; \
		exit 2; \
	fi; \
	adb_cmd start-server >/dev/null; \
	adb_cmd devices -l; \
	if ! adb_cmd get-state >/dev/null 2>&1; then \
		echo "No authorized device detected (or USB debugging not enabled)."; \
		exit 2; \
	fi; \
	if [ -z "$$dest" ]; then \
		dest="$$(adb_cmd shell '\
for d in /sdcard/ROMs /sdcard/roms /sdcard/Emulation/roms /sdcard/Games /sdcard/games; do \
  if [ -d "$$d" ]; then echo "$$d"; exit 0; fi; \
done; \
echo /sdcard/ROMs' | tr -d '\r')"; \
	fi; \
	echo "Using DEST=$$dest"; \
	adb_cmd shell "mkdir -p \"$$dest\""; \
	adb_cmd push -p "$$src/." "$$dest/"; \
	adb_cmd shell "ls -la \"$$dest\" | head -n 50"
	$(call success)
