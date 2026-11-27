# Philby

Philby runs persistent Pi agents in tmux. Each frame gives an agent its own conversation, working directory, and tools. Close a frame and reopen it to continue where you left off.

## First run

On macOS or Linux you need Node.js 22.19 or later, npm, GNU Make, Bash, and tmux.

1. From the checkout, run `make full-pi` and use `/login` to connect your provider. This checkout keeps its Pi configuration in `.pi/agent/`.
2. Set `DEFAULT_MODEL` in the checkout’s `.env` to a model available from that provider. The [example environment file](.env.example) shows the format.
3. Run `make` to open the frame chooser. Create a frame or select a saved one. A saved frame uses its own model.

## Working in a frame

A plain frame starts with Pi’s native coding tools, the prime directives, and the Make working convention from `FRAME.md`. Its own `SCOPE.md` supplies its purpose. The repository’s `AGENTS.md` guides development of Philby itself. [Frame convention](FRAME.md) · [Development guidance](AGENTS.md)

Each frame has a required `frame.env`. A new one contains just the model. Add opt-ins if the agent should see references to particular Makefiles, receive saved notes in its context, or communicate with other frames. Messaging requires both frames to opt in. Edit the file while the frame is closed, then reopen it. [Frame settings schema](shared/frame.env.schema)

Frames build their own tools in their Makefile and can use the shared targets. The Makefiles and the scripts they delegate to define each tool’s interface. [Shared Makefile](shared/Makefile) · [Workspace controls](tmux/README.md)

## Keeping your work

Each frame’s directory under `frames/` holds its working files and private `.state/`, including the saved conversation. Close the frame before copying its directory for backup. Keep credentials and frame state out of source control.

If an older saved frame is missing `frame.env`, use the `frame-config-migrate` target while it is closed to recover its model settings. [Project Makefile](Makefile)

[AGPL-3.0-only](LICENSE)
