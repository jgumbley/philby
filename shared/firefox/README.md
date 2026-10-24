# Firefox tools

This module controls your normal Firefox profile, preserving its cookies and logins. It uses Firefox's supported [WebDriver BiDi connection](https://developer.mozilla.org/en-US/docs/Web/WebDriver/How_to/Create_BiDi_connection).

Use `make -C shared/firefox help` from the repository root. Existing `make -C shared browser-...` commands delegate to this module. Panes can use `make -C "$PHILBY_ROOT/shared" browser-...`.

Once, quit Firefox normally, then run `make -C shared/firefox start`. This starts Firefox with `--remote-debugging-port 9222`, keeps it running independently of the pane, and verifies the connection. Firefox's own startup setting controls session restoration. Repeat this startup command after quitting Firefox; remote control cannot be enabled by passing flags to an already-running browser. `FIREFOX_PORT` overrides the port for every command. The connection stays on loopback. Commands fail if Firefox is unavailable; they never start a replacement browser or profile.

```sh
make -C shared/firefox tabs
make -C shared/firefox open URL=https://example.com
make -C shared/firefox eval TAB=example.com EXPR='document.title'
make -C shared/firefox screenshot TAB=example.com OUT=/tmp/page.png
```

`TAB` selects a unique URL or title using a case-insensitive substring or `*` pattern. Missing or ambiguous matches fail; `tabs` lists the URLs and titles to refine the selection. Context IDs are deliberately not exposed because Firefox changes them between automation sessions. CSS selectors must also match exactly one element.

| Target | Inputs and behavior |
| --- | --- |
| `tabs` | List tab URLs and titles |
| `open` | `URL`; open a normal window sharing the existing profile. Optional `MARK=slug` tiles and marks its Sway window; an existing mark focuses that window |
| `navigate` | `TAB`, `URL`; navigate an existing tab |
| `focus`, `close` | `TAB`; activate or close that tab |
| `eval` | `TAB`; JavaScript expression from `PROMPT_FILE`, `EXPR`, or stdin, in that order. Awaits promises and prints JSON; use an async IIFE for multiple statements |
| `click` | `TAB`, `SELECTOR`; native pointer click |
| `fill` | `TAB`, `SELECTOR`, `TEXT`; replace an editable text field using keyboard input; empty `TEXT` clears it |
| `press` | `TAB`, `KEY`; one character or Enter, Tab, Escape, Backspace, Delete, Space, ArrowLeft, ArrowUp, ArrowRight, ArrowDown |
| `fullscreen` | `TAB`, `SELECTOR`; request DOM fullscreen on the selected element, such as `video` |
| `screenshot` | `TAB`, `OUT`; save a viewport PNG |
| `windows` | List Firefox Sway window IDs, titles and marks |
| `window-focus`, `window-close` | `WINDOW`; exact Sway ID or mark |

Expressions run in the selected page with user activation, allowing media playback and fullscreen requests. Actions address the main document; page scripts and browser policies can still reject them, and those errors propagate. Inspect playback or `document.fullscreenElement` before claiming success. Relative `PROMPT_FILE` and `OUT` paths resolve from Make's working directory; use absolute paths when invoking `make -C` from another pane directory. Invoking this module with `make -f /absolute/path/to/shared/firefox/Makefile` preserves the caller's working directory.

The tools require `firefox` and util-linux `flock`; marked windows additionally require Sway. Invocations serialize per port in `XDG_RUNTIME_DIR`. Each invocation ends its automation session while leaving Firefox and its tabs open. Normal interruption closes the session; a hard-killed client can leave Firefox's sole automation session occupied, requiring an explicit Firefox restart. Commands never retry a page action; inspect the page before repeating a failed operation.

The module uses the root npm lockfile and dependencies, with its own TypeScript build output in `dist/`. Run `make -C shared/firefox check` to typecheck it and `make -C shared/firefox test` to run the existing integration suite against an isolated headless Firefox profile and local fixture pages, including fullscreen, keyboard input, screenshots and concurrent callers. The public wrappers `make -C shared browser-check` and `browser-test` run the same checks. Core Philby checks do not require Firefox.
