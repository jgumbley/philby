# Browser tools

These tools control your existing Chrome or Firefox session through pinned `puppeteer-core`. `browser-connect` opens a dedicated tmux service pane in the current Philby workspace and keeps one browser connection available for later commands. Tabs, cookies and logins remain in the browser's own profile. The tools do not launch a browser, download one or create an automation profile.

Use Node 22.19 or newer and install the repository dependencies with `make deps`. The browser module has its own TypeScript build and uses the root npm lockfile.

## Prepare the browser

For Chrome 144 or newer, open `chrome://inspect/#remote-debugging` in the profile you want to control and enable remote debugging. Accept Chrome's connection prompt when `browser-connect` starts the service. Subsequent commands reuse that approved connection. `BROWSER=chrome` discovers the running stable Chrome channel using Puppeteer's currently experimental `channel` connection option. See [Chrome's remote debugging documentation](https://developer.chrome.com/docs/devtools/agents/get-started/configuration).

For Firefox, quit it normally, then start the same application and normal profile with `--remote-debugging-port 9222`. On macOS the executable is `/Applications/Firefox.app/Contents/MacOS/firefox`; on Linux it is normally `firefox` on `PATH`. Passing the flag to an already-running Firefox does not enable remote control. Firefox's startup preferences determine whether existing tabs are restored. See [Firefox's BiDi connection documentation](https://developer.mozilla.org/en-US/docs/Web/WebDriver/How_to/Create_BiDi_connection).

`BROWSER=firefox` connects to `ws://127.0.0.1:9222/session`. For either browser, pass `BROWSER_ENDPOINT=ws://...` or `wss://...` to `browser-connect` to select an explicit WebSocket endpoint instead of its default connection method. HTTP discovery URLs are not accepted.

## Interface

| Shared target | Operation |
| --- | --- |
| `browser-connect` | Start the selected browser service, wait for its connection, or focus its existing service pane |
| `browser-disconnect` | Stop the service while leaving the browser and tabs open |
| `browser-status` | Report connection state, the busy caller and queued request count without starting a connection or joining the work queue |
| `browser-tabs` | List open page URLs and titles |
| `browser-run` | Execute an async function body with Puppeteer's `browser` and optional `page` objects |

Every command requires `BROWSER=chrome` or `BROWSER=firefox`. Connect explicitly before using `browser-tabs` or `browser-run`; neither starts or restarts a service. For `browser-run`, optional `TAB` selects exactly one page by a case-insensitive substring of its URL or title. Missing or ambiguous matches fail. Without `TAB`, `page` is undefined and `browser` is available for operations such as opening a new page.

The script body comes from `PROMPT_FILE`, then `prompt`/`PROMPT`, then stdin. Use `await` directly and `return` a JSON-serializable result; no returned value prints `null`. This is local Node.js code using the standard [Puppeteer API](https://pptr.dev/api), not a JavaScript expression evaluated in a web page. Use `page.evaluate()` when code should execute inside the page.

```sh
make -C shared browser-connect BROWSER=chrome
make -C shared browser-connect BROWSER=firefox
make -C shared browser-status BROWSER=chrome
make -C shared browser-tabs BROWSER=firefox
make -C shared browser-run BROWSER=chrome TAB=example.com prompt='return await page.title();'
make -C shared browser-run BROWSER=firefox TAB=example.com PROMPT_FILE=/absolute/path/read-page.js
```

The contents of `read-page.js` can be:

```js
return await page.evaluate(() => ({
  title: document.title,
  heading: document.querySelector('h1')?.textContent
}));
```

For a multiline script on stdin:

```sh
make -C shared browser-run BROWSER=chrome <<'JS'
const tab = await browser.newPage();
await tab.goto('https://example.com');
return {url: tab.url(), title: await tab.title()};
JS
```

Navigation, clicks, filling fields, keyboard input and screenshots use ordinary Puppeteer methods. Call `await page.bringToFront()` before interacting with a background tab. For example, `await page.locator('input[name="search"]').fill('Philby')` fills a field, and `await page.screenshot({path: '/absolute/path/page.png'})` saves a screenshot. [Puppeteer documents differences between Chrome and Firefox](https://pptr.dev/webdriver-bidi).

The shared wrapper delegates with `make -f`, preserving its caller's working directory. Each request carries that directory to the service, so relative prompt and output paths retain their caller's meaning. `make -C shared` sets that directory to `shared`. Use absolute paths when invoking from a pane, or use `make -f "$PHILBY_ROOT/shared/Makefile"` to retain the pane's directory.

## Service lifetime and concurrency

Each browser has one service pane in the workspace. A per-user SQLite lock is held for its lifetime, preventing another workspace from taking ownership of the same browser. Browser operations queue and run sequentially. `browser-status` bypasses that queue and does not query pages, so it remains responsive during awaited browser work. Synchronous script code that blocks Node's event loop can also delay status.

Connection startup has a 120-second deadline, including Chrome approval. Requests wait up to 60 seconds in the queue; scripts have a 120-second execution deadline.

Detaching from tmux leaves the service running. Closing an ordinary agent pane preserves an idle service; if it cancels an active browser request, the failure rules below apply. `browser-disconnect`, closing the service pane, or workspace cleanup stops it and releases the connection. There is no idle timeout or automatic restart. To connect again after shutdown, run `browser-connect` explicitly.

```sh
make -C shared browser-disconnect BROWSER=chrome
make -C shared browser-disconnect BROWSER=firefox
```

Disconnecting leaves the browser and its tabs open. Scripts may explicitly close pages they created; avoid closing the browser when the intention is only to finish a script.

## Failures and script boundaries

A normal awaited script error fails that request while preserving the service for later commands. Cancelling a queued request removes only that request. Cancellation, deadline expiry or loss of the calling client during an active request shuts down the service and fails pending requests. A browser disconnection also requires an explicit new connection. Errors exit nonzero; scripts are never automatically retried or replayed. An action may already have happened before a failure, so inspect the page before retrying a write.

An independent watchdog enforces the active request's deadline and detects caller exit even when script code blocks Node's event loop. Failed service panes retain their diagnostic output. An unresponsive service is forcibly terminated when explicitly disconnected or during workspace cleanup, and the command reports the interruption.

Firefox can retain its single BiDi session after a forced process termination. If reconnecting reports an occupied session, restart Firefox normally with remote debugging enabled, then run `browser-connect` again. The tool does not restart your browser automatically.

Await every operation and finish all work before returning. Do not leave background timers, callbacks or unawaited promises running. Treat each script as independent: persistent JavaScript globals are not part of the interface. Puppeteer methods retain their documented behavior, including locator waiting and retries.

## Verification

```sh
make -C shared/browser check test
```

The shared aliases `browser-check` and `browser-test` run the same checks. Automated browser checks use temporary profiles, local fixture pages and isolated tmux servers. No personal profile is used by the automated suite.

On 2026-10-26, the persistent service passed all 25 browser tests on macOS arm64 with Node 24.10.0. All 11 tmux tests and 55 core tests passed, together with the core and browser typechecks.

The live Chrome connection attempt on 2026-10-26 reached the service's `connecting` state and exceeded its 120-second connection deadline. The desktop approval check remains pending. Run `browser-connect` again and accept Chrome's prompt, then use `browser-status` and a disposable page through `browser-run` to verify reuse of that approved connection. Linux verification is pending a separate session; see [linux.txt](../../linux.txt).
