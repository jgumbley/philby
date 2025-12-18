# philby

Philby is a tiny, Make-driven harness for running an LLM “agent” against a repo in a controlled, repeatable way.

The repo is intentionally small:
- `AGENTS.md` is the contract: the rules the agent must follow (use `make`, stay in this directory, no hidden fallbacks, etc).
- `Makefile` is the entrypoint: it forwards all user/agent commands into `common.mk`.
- `common.mk` is the implementation: it defines the standard targets used to inspect/update the repo and to run commands that might prompt for secrets.
- `pane.sh` is used by `make agent-*` to run a target in a tmux split pane so a human can type secrets locally while the agent watches output.

## How you use it

1. Run `make digest` to print a canonical “context bundle” of the project files. This is the sanctioned way to understand what’s here.
2. Run everything via `make` targets (don’t invoke scripts/tools directly).
3. When a command might prompt for secrets (sudo/BECOME, etc), use an agent pane: `make agent-<target>`.

## Standard targets

- `make digest`: generates a summary of the important business rules in the codebase.
- `make ingest`: copies the digest to the clipboard via `pbcopy` (will fail if `pbcopy` is not available).
- `make update`: refreshes `AGENTS.md` from upstream (`curl` required) and overwrites the local file.
- `make clean`: removes `.venv/`.
- `make agent-<target>`: runs `make <target>` inside a tmux split pane (requires `tmux` and being inside an existing tmux session).

## Python environment

If you need a Python venv for targets in this repo, run `make .venv/`. It uses `uv` and installs from `requirements.txt`.
