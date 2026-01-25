.DEFAULT_GOAL := .venv

.PHONY: .venv digest ingest clean pane update sync install-philby spec spec-doc agent test

ADB ?= adb
SERIAL ?=
SRC ?= ../warez
DEST ?=
PHILBY_EXPORT_FILES ?= AGENTS.md CLAUDE.md
PHILBY_SPEC_TARGETS ?= spec
SPEC_TARGETS ?= spec-doc
PHILBY_REQUIRED_FILES ?= Makefile Makefile.new common.mk README.md pane.sh philby-spawner.sh philby-worker.sh
PHILBY_REQUIRED_COMMANDS ?= awk grep find
PHILBY_FEATURE_COMMANDS ?= curl wl-copy fixip tmux adb uv

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

spec:
	@set -eu; \
	if [ -z "$(SPEC_TARGETS)" ]; then \
		echo "SPEC_TARGETS is empty" >&2; \
		exit 2; \
	fi; \
	echo "Executing spec targets: $(SPEC_TARGETS)"; \
	for t in $(SPEC_TARGETS); do \
		$(MAKE) "$$t"; \
	done
	$(call success)

spec-doc:
	@set -eu; \
	if ! grep -q "PHILBY_SPEC_START" README.md; then \
		echo "Missing PHILBY spec block in README.md" >&2; \
		exit 2; \
	fi; \
	if ! grep -q "PHILBY_SPEC_END" README.md; then \
		echo "Missing PHILBY spec block end in README.md" >&2; \
		exit 2; \
	fi; \
	awk 'BEGIN{printing=0} /PHILBY_SPEC_START/ {printing=1; next} /PHILBY_SPEC_END/ {printing=0; exit} printing {print}' README.md

agent:
	@set -eu; \
	PHILBY_SPEC_TARGETS="$(PHILBY_SPEC_TARGETS)" \
	bash ./philby-spawner.sh
	$(call success)

test:
	@set -eu; \
	echo "Running philby self-test"; \
	for file in $(PHILBY_REQUIRED_FILES); do \
		if [ ! -f "$$file" ]; then \
			echo "Missing required file: $$file" >&2; \
			exit 2; \
		fi; \
	done; \
	for cmd in $(PHILBY_REQUIRED_COMMANDS); do \
		if ! command -v "$$cmd" >/dev/null 2>&1; then \
			echo "Missing required command: $$cmd" >&2; \
			exit 2; \
		fi; \
	done; \
	if [ -z "$${TMUX:-}" ]; then \
		echo "TMUX is required for the pane target" >&2; \
		exit 2; \
	fi; \
	for cmd in $(PHILBY_FEATURE_COMMANDS); do \
		if ! command -v "$$cmd" >/dev/null 2>&1; then \
			echo "Missing command for full functionality: $$cmd" >&2; \
			exit 2; \
		fi; \
	done; \
	$(MAKE) spec-doc >/dev/null; \
	$(MAKE) spec >/dev/null; \
	$(MAKE) agent >/dev/null; \
	$(MAKE) digest >/dev/null
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
	$(MAKE) digest | fixip | wl-copy
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
# locally while the agent watches output. Usage: make pane target=<target>
pane:
	@set -eu; \
	cmd_target="$(target)"; \
	if [ -z "$$cmd_target" ]; then \
		bash ./pane.sh --shell "agent-shell"; \
	else \
		bash ./pane.sh "agent-$$cmd_target" $(MAKE) "$$cmd_target"; \
	fi

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
