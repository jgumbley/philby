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

`make -C shared browser-connect BROWSER=chrome` or `BROWSER=firefox` opens a dedicated `@browser-chrome` or `@browser-firefox` service pane. Its foreground Puppeteer process keeps the connection open and prints the active caller and queue count. Shared `browser-status` reports that state directly. These panes have no agent conversation or Durable store. `browser-disconnect` stops the selected service; workspace cleanup stops all browser services before shutting down tmux. Browser windows and tabs remain open. See the [browser lifecycle](../shared/browser/README.md).

Ctrl-End moves to the next window, or opens a pane selector when already at the last window. Use Up/Down and Enter to select a saved pane or **New pane**. Saved panes show whether they are open or closed; selecting one focuses its existing window or resumes its saved conversation. **New pane** asks for a type, then a slug. Escape steps back through those screens, or closes the selector from the pane list; with no saved panes, Escape at the type screen cancels. Ctrl-C and Ctrl-D close the selector from any screen. `make pane-new` opens the same selector. Ctrl-Home moves to the previous window. `make window` opens an ordinary shell.

On macOS in Kitty, interactive startup installs **Cmd-Option-Right** for Ctrl-End and **Cmd-Option-Left** for Ctrl-Home before attaching to Philby. Right moves forward or opens the selector at the last window; Left moves back. Linux keeps Ctrl-End and Ctrl-Home. Other terminals keep the existing bindings.

Kitty must permit remote control (`allow_remote_control yes` in its configuration). Philby sends Kitty two conditional runtime mappings scoped to the Kitty window containing the launch. They remain available in that Kitty window, including its other tmux views, for the Kitty process lifetime. Kitty reloads its configuration while applying the overrides; Philby does not write its configuration files or use AppleScript. Each enclosing tmux session must have one attached client and unlinked windows, with nested servers using sockets in the same directory. Philby briefly enables passthrough on the enclosing panes and restores their previous settings after Kitty acknowledges setup. Refused or unanswered requests fail startup explicitly. Detection uses Kitty's `KITTY_WINDOW_ID` environment marker; a tmux server retaining that marker after reattaching from another terminal also fails explicitly if Kitty cannot respond. Detached starts skip terminal configuration.

`make pane-list` includes saved agent slugs and every live tmux view, including ordinary shells and splits. A saved agent is already closed. Window numbers can change as windows close; use slugs for agent operations and the listed pane IDs for tmux commands. Shell windows have no agent store or command socket.

`PHILBY_DETACHED=1 make` opens without attaching. `PHILBY_PANES_DIR` selects the pane hierarchy, defaulting to `panes/` under the repository root. Each pane keeps its tools and `.state/` together. The default tmux server identity follows that hierarchy; `PHILBY_TMUX_SOCKET` selects an explicit server. Workspace locks and command sockets live in a temporary runtime directory. Tests isolate the pane hierarchy and tmux server.

Use `/quit` from any agent pane, or `make quit` from a shell. Confirm with `y` to gracefully close every pane and the Philby tmux workspace, preserving conversations, memory, queued work, checks and tools. `make cleanup` provides noninteractive closure. After quitting, run `make` to choose a saved pane or `make pane slug=...` to resume it directly.

Run `make -C tmux check` for the shared TypeScript checks and `make -C tmux test` for this module's integration suite. The tests use deterministic providers, temporary state and isolated tmux servers; they do not call paid models or use the live workspace. Terminal tests use util-linux `script` on Linux and the system `script` on macOS, selecting arguments by platform. Other platforms fail explicitly.

The macOS test helper passes input through a shell pipe because its `script` rejects the socket Node uses for child stdin. The helper preserves command arguments and child exit status without additional dependencies.
