# philby-glm

Philby GLM is a Makefile-first Pi operator harness for coordinating determinate
local tasks through tmux panes.

The default model is OpenRouter `moonshotai/kimi-k3` with `max` reasoning. The
scoped model cycle also includes OpenRouter `z-ai/glm-5.2` with `high` reasoning.
Local Pi state lives under `.pi/agent`, while secrets, sessions, logs, and
generated artifacts stay untracked.

## Use

Start Philby from a normal shell:

```sh
cd /home/system/wip/philby-glm
make
```

`make` starts or attaches a Philby-owned tmux server using `tmux/philby.conf`,
then runs the primary Philby GLM operator in the single `philby` pane on window
`1`. `make run` is an explicit alias for the same path. `make pi` remains the
lower-level launch target for the same agent.

Run checks:

```sh
make test
```

Show the configured model and the active model cycle list:

```sh
make models
```

Query OpenRouter's public model catalog without sending local credentials:

```sh
make openrouter-models query=kimi
```

Override models for a run:

```sh
make run PI_MODEL=openrouter/z-ai/glm-5.2 PI_THINKING=high
make run PI_MODEL=openrouter/moonshotai/kimi-k3 PI_THINKING=max
make run PI_MODELS='openrouter/moonshotai/kimi-k3:max,openrouter/z-ai/glm-5.2:high'
```

Spawn a subagent pane:

```sh
make subagent name=review prompt='Read Makefile and AGENTS.md, then review the current changes.'
```

Generate and display a local image artifact through Kitty when available:

```sh
make image-demo
make image-show IMAGE=.pi/artifacts/operator-demo.png
```

## Secrets

`make pi` loads `.env` if present and requires `OPENROUTER_API_KEY`.

Tracked files use the environment variable name only. The local `.env` file is ignored by git.

## Shape

- `Makefile` is the public entry point.
- `common.mk` owns the implementation of targets.
- `tmux/philby.conf` is the repo-local tmux configuration used by bare `make`.
- `pane.sh` opens or reuses tmux panes.
- `.pi/agent/extensions/` contains repo-local Pi extensions.
- `.pi/agent/themes/` contains the repo-local Pi theme.
- `system.md` is the default Philby GLM personality.
- `AGENTS.md` is the repo contract for coding agents.
- `scripts/image_demo.py` is a deterministic local visual-artifact generator.
