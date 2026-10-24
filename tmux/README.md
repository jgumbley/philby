# Philby tmux

This module owns Philby's tmux workspace: launching panes, focusing existing views, attaching terminals, opening the pane selector and shell windows, listing views, and stopping the server. Its configuration, TypeScript adapter and integration tests live here. The application owns conversation state and graceful pane shutdown.

Use the root Makefile to operate the workspace:

```sh
make
make pane slug=research
make pane-new
make pane-list
make pane-stop slug=research
make pane-close slug=research
make window
make quit
make cleanup
```

Bare `make` opens the pane selector, starting the tmux workspace if needed. With no saved panes, it asks for a type and name. Cancelling creates no pane or conversation state. There is no built-in coordinator; every agent is an explicitly named ordinary pane. `philby` is the tmux session name. Reopening the selector focuses its existing window.

Each agent has one tmux window; its window name and pane title equal its slug. Opening an existing pane focuses it. Concurrent openings share a launch lock, preserving one application process per slug. `Ctrl-b d` detaches while processes keep running. `cleanup` gracefully closes owned processes without deleting state or tools.

Ctrl-End moves to the next window, or opens a pane selector when already at the last window. Use Up/Down and Enter to select a saved pane or **New pane**. Saved panes show whether they are open or closed; selecting one focuses its existing window or resumes its saved conversation. **New pane** asks for a type, then a slug. Escape steps back through those screens, or closes the selector from the pane list; with no saved panes, Escape at the type screen cancels. Ctrl-C and Ctrl-D close the selector from any screen. `make pane-new` opens the same selector. Ctrl-Home moves to the previous window. `make window` opens an ordinary shell.

`make pane-list` includes saved agent slugs and every live tmux view, including ordinary shells and splits. A saved agent is already closed. Window numbers can change as windows close; use slugs for agent operations and the listed pane IDs for tmux commands. Shell windows have no agent store or command socket.

`PHILBY_DETACHED=1 make` opens without attaching. `PHILBY_PANES_DIR` selects the pane hierarchy, defaulting to `panes/` under the repository root. Each pane keeps its tools and `.state/` together. The default tmux server identity follows that hierarchy; `PHILBY_TMUX_SOCKET` selects an explicit server. Workspace locks and command sockets live in a temporary runtime directory. Tests isolate the pane hierarchy and tmux server.

Use `/quit` from any agent pane, or `make quit` from a shell. Confirm with `y` to gracefully close every pane and the Philby tmux workspace, preserving conversations, memory, queued work, checks and tools. `make cleanup` provides noninteractive closure. After quitting, run `make` to choose a saved pane or `make pane slug=...` to resume it directly.

Run `make -C tmux check` for the shared TypeScript checks and `make -C tmux test` for this module's integration suite. The tests use deterministic providers, temporary state, isolated tmux servers and util-linux `script`; they do not call paid models or use the live workspace.
