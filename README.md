# Philby

Philby is a general-purpose working environment for persistent agents. Work is organised into panes, each with a continuing conversation, memory, instructions and tools. Return to a pane to inspect its work and change its direction. Its work survives closing and reopening it.

The kernel provides continuity, communication and control. Panes build small reusable tools for their responsibilities and expose them through Make. You decide what the panes are for and steer their work.

## Start

Use Node 22.19 or newer, npm, GNU Make, bash and tmux on macOS or Linux. Clone this repository, enter its directory, then run:

```sh
make deps
```

Configure providers through `make full-pi` as described below, then list them with `make -C shared provider-models`. Before creating a new pane, set `DEFAULT_MODEL=provider/model-id` in the environment or root `.env`. To use `.env` for the first time, copy `.env.example` to `.env` and edit it; preserve an existing file. Pi creates its configuration files under `.pi/agent/` as needed.

```sh
make
```

`make deps` installs the resolved npm lockfile. Dependency declarations follow npm `latest`; `make deps-update` refreshes the lockfile and installation. `make` builds the application and opens the create/open pane screen in tmux. With no existing panes it starts at pane creation; no agent starts until you create or select a pane. Every pane is an ordinary workspace, with no built-in coordinator. `/model` selects and saves a pane's model. Saved panes retain their selection when reopened. Unknown models and missing credentials fail explicitly; Philby does not substitute another model.

```sh
make pane slug=research
make pane-new
make pane-list
make pane-close slug=research
make quit
```

Slugs are immutable and unique: 1–64 lowercase letters, digits or hyphens, beginning with an alphanumeric character. Opening a running pane focuses it; opening a closed pane resumes its conversation. `Ctrl-b d` detaches while work continues. `make quit` asks before closing all panes; `make cleanup` does the same cleanup without confirmation and retains state and tools.

Use `PHILBY_DETACHED=1 make` to open without attaching. Terminal navigation, pane selection and workspace controls are documented in [tmux](tmux/README.md).

In Kitty on macOS, startup installs Cmd-Option-Right to move forward or open the pane selector, and Cmd-Option-Left to move back. Enable `allow_remote_control yes` in Kitty. Linux uses Ctrl-End and Ctrl-Home.

## Providers

Philby uses Pi's `ModelRuntime` for providers, authentication, model catalogs and request handling. Its native Pi configuration lives inside this checkout:

```text
.pi/agent/models.json        Custom providers, endpoints and model definitions
.pi/agent/auth.json          Pi-managed API keys and OAuth credentials
.pi/agent/models-store.json  Pi-managed catalog cache
.pi/agent/settings.json      Native Pi settings, including the model shortlist
```

Every pane, consultation helper and provider command uses this directory. Philby sets `PI_CODING_AGENT_DIR` to its absolute path, overriding an inherited directory setting. File configuration is independent of `~/.pi/agent`; provider environment variables remain supported. Each checkout can configure its own providers, shared by all its panes. The `agent` subdirectory keeps Pi's agent settings separate from its project-level `.pi/settings.json`.

The live `.pi/` directory is Git-ignored. Keep credential-free examples in the repository; Pi owns credential storage, permissions and token refresh.

Open the complete native Pi interface with this checkout's configuration:

```sh
make full-pi
```

`make` opens Philby; `make full-pi` opens Pi's full UI, including its normal startup screen. Inside Pi, use `/login` to authenticate, `/logout` to remove a stored credential, or `/scoped-models` to edit the model shortlist. Pi handles authentication and stores credentials in `.pi/agent/auth.json`. For Codex subscription access, run `/login openai` and choose **Sign in with ChatGPT**. Plain `npx pi` uses Pi's own directory selection, so use `make full-pi` for this checkout. OpenRouter also accepts its normal `OPENROUTER_API_KEY` environment variable.

```sh
make -C shared provider-models
make -C shared provider-models PROVIDER=openrouter
```

The helper refreshes through Pi and lists available chat models with their provider IDs and context/output limits. Provider errors are printed separately while healthy model entries remain visible; errors make the command exit nonzero. `/model` uses Pi's native picker with the same runtime. Type to search by provider, model ID or name. Availability follows Pi's authentication and catalog rules; the upstream service still decides whether an individual request is allowed.

Set `enabledModels` in `.pi/agent/settings.json` to show a shortlist when opening `/model`. Entries use Pi's native exact IDs or wildcard patterns, such as `openrouter/z-ai/*` and `llama-local/**`. Use `**` when a model ID contains slashes. Press Tab in the picker to switch between `scoped` and `all` models. The full catalog stays available, and existing pane selections are preserved. With no shortlist, the picker shows all available models. Settings are read each time the picker opens; malformed settings and unmatched patterns are reported.

For a work gateway or local server, add its provider to `.pi/agent/models.json` using the standard [Pi model configuration](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md). The credential-free [models.json.example](models.json.example) shows a local OpenAI-compatible server. Merge the relevant entry into this checkout's `.pi/agent/models.json`, replace `your-loaded-model` with the exact server model ID, and set context/output limits to the server's actual capacity. The example's `local` key is a dummy value for an unauthenticated loopback server. For an authenticated gateway, use Pi's credential configuration or environment interpolation for the real key. Pi reserves 4,096 context tokens beyond its prompt estimate when limiting output. Size the server for Philby's instructions, conversation, that reserve and the reply; an 8,192-token context can leave only one output token. The example uses 32,768, which must match the actual server allocation.

Custom model IDs do not need to appear in Pi's bundled catalog. Use provider IDs such as `work` or `llama-local` consistently because saved panes retain their exact provider/model selection. Pi supplies built-in provider catalogs, caching, compatibility handling and supported discovery; a compatible endpoint's `/models` response does not necessarily include every piece of model metadata.

Root `.env` selects the default for new panes with `DEFAULT_MODEL=provider/model-id`. The first slash separates the provider from the complete model ID. Reopening a saved pane keeps its selection even when the new-pane default has changed or is absent. An unavailable saved model is reported explicitly; Philby does not replace the conversation or silently choose another model. Model changes preserve conversation, memory and queued work.

Legacy root `*.provider` files and `.state/providers.sqlite` are no longer read. Configure the required providers through `make full-pi` and `.pi/agent/models.json` before reopening existing panes. Consultation helpers use the same runtime; they do not add synthetic model aliases.

## Instructions and tools

[PANE.md](PANE.md) supplies the operating guidance shared by every pane. `panes/<slug>/SCOPE.md` defines that pane's standing purpose, responsibilities, boundaries and subject-specific conventions. Both files are read when the pane opens and included in model requests after compaction. Close and reopen to load edits. A scope is ordinary Markdown with no required sections; a new plain pane starts with an empty scope. Root and module `AGENTS.md` files guide software development and are not loaded as runtime pane instructions.

When upgrading an existing pane, rename its `AGENTS.md` to `SCOPE.md`, preserving the contents. If `SCOPE.md` already exists, inspect the files rather than overwriting it. A pane with only the old filename fails with a migration message; Philby does not fall back to it or replace it with a blank scope. This rename does not change its conversation or memory.

Every pane can use shared tools, even with an empty local toolset. Its first model request includes labeled literal sources from its Makefile and `shared/Makefile`. Both files are reread before every subsequent model request, including continuations after tool calls; changed sources refresh the supplied snapshots without reopening the pane. The latest snapshot is authoritative. Agents inspect these sources before building a capability and follow delegated Makefiles or scripts on demand.

Native `read`, `edit`, `write` and `bash` tools run in the pane's directory. Purpose-specific operations and diagnostics run through reusable Make targets: `make target` for pane tools or `make -C "$PHILBY_ROOT/shared" target` for shared tools. Namespaces organise tools; they are not a filesystem sandbox.

Pane types are creation recipes. `make pane slug=knowledge TYPE=graphwiki` creates a pane with graph tools; omitting `TYPE` creates a plain pane. Each recipe provides an initial `SCOPE.md`. Reopening preserves edited files and never reapplies the recipe. Requesting a different type for an existing pane fails. Creating a mailbox alone does not choose a type.

Graphwiki panes record all sourcing, attribution and references only in dated
journals at write time, then maintain concept articles as the wiki reading view.
Articles link to related concepts and retain material uncertainty; they contain
no provenance metadata, journal links or source narration. Journal entries link
to the articles they inform. The pane's `editorial-check` target checks common
provenance markers before publication and during `lint`; manual editorial review
is still required. See the recipe's [editorial interface](pane-types/graphwiki/EDITORIAL.md).
Existing panes need their scope and tools updated explicitly, then reopening to
load the new scope; creation recipes are never reapplied automatically.
Use `make browse` in a Graphwiki pane for the local read-only terminal browser.
Wiki and Journal views have clickable links and backlinks. No web service starts
when a pane opens. Pane-specific HTML previews remain ordinary local tools.
See the [graphwiki module](shared/graphwiki/README.md) for terminal controls.

An optional nonempty `BOOT.md` queues an opening checklist behind recovered work. Its unfinished task resumes without duplicate submission. A pane with `BOOT.md` must supply a `make close` target for teardown. Closure suspends Durable work first, then awaits teardown with a 60-second deadline. Failures are reported while application resources are released. Detaching leaves work running.

All pane directories are private and ignored by this repository. Clone or create independent pane repositories at `panes/<slug>` as needed, keeping `.state/` ignored there too. Creating a pane does not automatically initialise a Git repository.

## Conversation, memory and messages

Enter submits, Shift-Enter inserts a newline, and follow-ups queue while work is running. Escape or `/stop` cancels current work while preserving queued input. `/steer message` steers at the next model boundary. Ctrl-O expands tool output.

| Command | Operation |
| --- | --- |
| `/model` | Select and save this pane's model |
| `/memory`, `/memory notes` | Inspect or edit durable memory |
| `/checks`, `/check {JSON}` | Inspect or configure recurring reviews |
| `/pause id`, `/resume id`, `/remove id` | Manage reviews |
| `/tools` | Inspect pane and shared Makefiles |
| `/updates` | Read and mark passive reports |
| `/send slug message` | Queue input in the receiving pane |
| `/report slug message` | Record a passive update in the receiving pane |
| `/plan`, `/plan on`, `/plan off [plan]` | Read-only plan mode: research and present a plan before editing |
| `/new` | Start a fresh session, preserving files, tools, memory and archived history |
| `/close`, `/quit` | Suspend this pane or confirm closing the workspace |

Memory fields are `responsibilities`, `notes`, `decisions`, `outstanding` and `sources`. They live separately from the transcript and enter model requests after compaction. `SCOPE.md` is the standing definition of the pane's remit; memory holds learned facts, decisions and working context. The existing `responsibilities` field and its saved contents remain available without copying the scope into it. Model changes preserve conversation, memory and queued work.

Plan mode restricts the pane to read-only operations. While active, the model can use the native `read` tool to examine files but cannot edit files or run shell commands. The header shows `PLAN MODE` when active. Entering plan mode requires no active work; exit with `/plan off` to resume normal operation. An approved plan supplied at exit is included in subsequent model context.

```sh
make pane-plan slug=research
make pane-plan-set slug=research ACTIVE=1
make pane-plan-set slug=research ACTIVE=0 PLAN='1. Implement the feature'
printf '1. Step one\n2. Step two\n' | make pane-plan-set slug=research ACTIVE=0
```

`ACTIVE` must be exactly `0`, `1`, `true`, or `false`. A nonempty `PLAN` supplies the approved plan; otherwise use the usual `PROMPT_FILE`, `PROMPT`/`prompt`, then stdin precedence. Exiting without replacement text preserves any previously saved plan. Reads of explicit prompt files fail visibly if unavailable.

`/new` starts a fresh model context in the existing Durable conversation while retaining prior transcript entries, files, tools, instructions, durable memory, model selection and review schedules. Plan mode begins off with no approved plan in the fresh context. `/new` rejects while work is active, queued or awaiting mailbox delivery; it does not cancel work. Reopening preserves the fresh context. Add `ALL=1` to capture the full archived history in chronological order.

```sh
make pane-new-session slug=research
make pane-capture slug=research ALL=1
```

```sh
make pane-memory slug=research FIELD=notes PROMPT_FILE=/absolute/path/notes.txt
make pane-send slug=research from=work REQUEST_ID=research-001 PROMPT_FILE=/absolute/path/request.txt
printf 'First line\nSecond line\n' | make pane-send slug=research from=work
make pane-report slug=work from=research prompt='Review complete'
make pane-updates slug=work MARK=1
make pane-capture slug=research
```

Prompt precedence is `PROMPT_FILE`, `PROMPT`/`prompt`, then stdin. Files and stdin preserve multiline content and shell metacharacters. Relative paths use the command's working directory; use absolute paths with `make -C`. Failures return nonzero. Capture returns the active transcript as JSON, even for a closed pane; treat that output as private.

Messages and reports require `slug` to identify the receiving pane. `from` identifies the sender; inside a pane it can be inferred from `PHILBY_PANE`, while commands run outside a pane must supply it. Acceptance means the receiving mailbox transaction has committed, including when that pane is closed. It does not mean the work is complete. Reuse the same stable `REQUEST_ID` for retries. Conflicting content for an ID is rejected within the receiving pane; there is no global ID registry. Reports remain passive.

Reviews are opt-in:

```sh
printf '%s' '{"id":"hourly","intervalMs":3600000,"prompt":"Review outstanding work."}' | make pane-check-set slug=research
make pane-check-pause slug=research ID=hourly
make pane-check-pause slug=research ID=hourly PAUSED=false
make pane-check-remove slug=research ID=hourly
```

Choose `intervalMs` (an integer of at least 1000) or `daily` (`HH:mm`), with an optional IANA `timezone`; the default is `Europe/Isle_of_Man`. Daily schedules follow local wall time across daylight saving. Reviews queue behind conversation, cannot overlap themselves and coalesce missed occurrences. Closing suspends them; reopening restores them. Unchanged reviews answer `NO_CHANGE`.

## Modules

| Location | Responsibility | Documentation |
| --- | --- | --- |
| `src/`, `test/` | Conversations, memory, mailboxes, reviews, CLI and TUI | This README |
| `tmux/` | Workspace adapter, configuration and terminal integration tests | [tmux](tmux/README.md) |
| `shared/browser/` | Puppeteer tools for existing Chrome and Firefox sessions | [Browser](shared/browser/README.md) |
| `shared/ocr/` | Local English text extraction from screenshots and PDFs | [OCR](shared/ocr/README.md) |
| `shared/slides/` | Local PPTX generation with PptxGenJS | [Slides](shared/slides/README.md) |
| `shared/google-workspace/` | Read-only Google Chat, Docs, Sheets, Slides and Drive tools using gogcli | [Google Workspace](shared/google-workspace/README.md) |
| `shared/graphwiki/` | Graph operations, command wrapper and Rust tests | [Graphwiki](shared/graphwiki/README.md) |

The tmux adapter builds with the core. Browser tools have their own TypeScript build; OCR and slides run as Node scripts. These modules reuse the root npm dependencies, including `puppeteer-core`, `scribe.js-ocr`, English OCR assets and `pptxgenjs`. Graphwiki owns its Cargo lockfile. Plain panes do not require a browser or Rust.

`shared/Makefile` exposes `browser-connect`, `browser-disconnect`, `browser-status`, `browser-tabs` and `browser-run`, plus the `wiki-*` tools. Run `make -C shared help` to discover them. Browser tools require `BROWSER=chrome|firefox` and an existing browser prepared for remote control. `browser-connect` opens a dedicated tmux service pane that owns one persistent Puppeteer connection; Chrome approval is needed when that connection starts. Later commands reuse it, preserving the browser's profile. `browser-run` executes a standard Puppeteer async function body supplied through a prompt file, `prompt`, or stdin. See the [browser setup and examples](shared/browser/README.md). Graphwiki requires Rust, Cargo and `flock`.

The browser service survives detaching and closing ordinary agent panes while idle. `browser-disconnect`, closing its service pane, or workspace cleanup stops it while leaving the browser and tabs open. A per-user lock prevents another workspace from controlling the same browser. Browser operations queue; status bypasses the queue. Cancelling an active request stops the service and fails pending requests. Services never start implicitly, time out while idle, restart automatically or replay scripts.

Shared `ocr` reads one complete local PDF, PNG or JPEG and writes English text to stdout, preserving page boundaries. Use `make -C shared ocr INPUT=/absolute/path/document.pdf`; add `OUTPUT=/absolute/path/new-text.txt` to create a file without overwriting an existing one. It runs directly with local model assets and exits after cleanup. `ocr-diagnose` checks dependencies without reading a document. Download or export browser files separately before invoking OCR. See [OCR usage and limitations](shared/ocr/README.md).

Shared `ask`, `reason` and `twitter` provide fresh consultations without local tools or pane context. They share the instance provider configuration and the same prompt inputs. Override `ASK_MODEL`, `REASON_MODEL` or `TWITTER_MODEL` in root `.env` or the command environment using `provider/model-id`. Their defaults are `openrouter/z-ai/glm-5.2`, `openrouter/openai/gpt-5.5`, and `openrouter/x-ai/grok-4.3`, respectively. The selected model must be available through Pi.

Shared `slides-generate` creates a local PPTX from an asynchronous JavaScript body receiving a PptxGenJS `pptx` instance. Use `make -C shared slides-generate PROMPT_FILE=/absolute/path/deck.js OUTPUT=/absolute/path/deck-v1.pptx`. The wrapper saves the result exclusively; choose a new output filename for each revision. Branding, masters and layout functions belong in the calling pane's source. `slides-diagnose` verifies local serialization without a browser, model provider or Google account. See [Slides usage and example](shared/slides/README.md).

Shared `google-workspace-*` targets read Google Chat, Docs, Sheets, Slides and Drive through the current `gog` on `PATH`. The macOS `core-tools` role in `../setup-system` installs the latest gogcli through `make setup`; Philby neither vendors nor pins the client and has no runtime dependency on that checkout. Supply `GOOGLE_ACCOUNT=email` on data commands. `google-workspace-read URL=...` reads a document, `google-workspace-spaces` lists Chat spaces, and `google-workspace-messages SPACE=spaces/...` reads messages. `google-workspace-export` and `google-workspace-download` create private output files without overwriting existing files. Authentication explicitly selects gog's `default` OAuth client and combined read-only service authorization. See [Google Workspace setup, inputs and verification](shared/google-workspace/README.md).

## State and verification

Each pane lives entirely under `panes/<slug>/`: its scope, Makefile, tools, working files and private `.state/` directory. `.state/durable.sqlite` stores conversation, memory and task state; `.state/app.sqlite` stores mailbox records and reports. Each slug has one application process and Durable store. A SQLite lifetime lock prevents duplicate owners; private Unix sockets carry local commands.

`PHILBY_PANES_DIR` relocates the complete pane directory tree, including state. `PHILBY_HOME` is no longer supported and is rejected. `PHILBY_TMUX_SOCKET` isolates the tmux server. Tests use temporary directories and deterministic providers. Unsafe interrupted tools are reported rather than replayed automatically. Back up pane directories with panes closed or with SQLite-aware tooling.

Legacy `.philby/` state and outbox migrations are no longer shipped. Complete
those migrations with a prior Philby version before upgrading. Philby rejects
legacy state rather than replacing or importing the saved conversation.

```sh
make help
make digest
make check
make test
make -C tmux test
make -C shared/browser check test
make -C shared/ocr check test
make -C shared/slides check test
make -C shared/google-workspace check test
make -C shared/graphwiki check test
```

Core checks need no browser or Rust toolchain. `make check-all test-all` runs the aggregate checks and suites. Existing tests cover persistence, message delivery, memory, instructions, recovery, pane recipes and module behaviour. Terminal tests require util-linux `script` on Linux or the system `script` on macOS. Pane-specific workflows are verified through their own Make targets. `make ingest` copies the existing tracked-file digest to the desktop clipboard.
It uses `pbcopy` on macOS, `wl-copy` when Linux has `WAYLAND_DISPLAY`, or
`xclip -selection clipboard` when Linux has only `DISPLAY`. Install `wl-clipboard`
for Wayland or `xclip` for X11. A headless Linux session fails explicitly. A missing
or failing selected command is reported; no other backend is tried. The digest
must finish successfully before the clipboard is touched.

Linux verification of the browser and OCR modules is pending a separate session; [linux.txt](linux.txt) records the checks to run and results to collect.

## License

Philby is licensed under the GNU Affero General Public License, version 3 only (`AGPL-3.0-only`). See [LICENSE](LICENSE).
