# Philby

Philby is a general-purpose working environment for persistent agents. Work is organised into frames, each with a continuing conversation, memory, instructions and tools. Return to a frame to inspect its work and change its direction. Its work survives closing and reopening it.

The kernel provides continuity, communication and control. Frames build small reusable tools for their responsibilities and expose them through Make. You decide what the frames are for and steer their work.

## Start

Use Node 22.19 or newer, npm, GNU Make, bash and tmux on macOS or Linux. Clone this repository, enter its directory, then run:

```sh
make deps
```

Configure providers through `make full-pi` as described below, then list them with `make -C shared provider-models`. Before creating a new frame, set `DEFAULT_MODEL=provider/model-id` in the environment or root `.env`. To use `.env` for the first time, copy `.env.example` to `.env` and edit it; preserve an existing file. Pi creates its configuration files under `.pi/agent/` as needed.

```sh
make
```

`make deps` installs the resolved npm lockfile. Dependency declarations follow npm `latest`; `make deps-update` refreshes the lockfile and installation. `make` builds the application and opens the create/open frame screen in tmux. With no existing frames it starts at frame creation; no agent starts until you create or select a frame. Every frame is an ordinary workspace, with no built-in coordinator. `/model` selects and saves a frame's model. Saved frames retain their selection when reopened. Unknown models and missing credentials fail explicitly; Philby does not substitute another model.

```sh
make frame slug=research
make frame-new
make frame-list
make frame-close slug=research
make quit
```

Slugs are immutable and unique: 1–64 lowercase letters, digits or hyphens, beginning with an alphanumeric character. Opening a running frame focuses it; opening a closed frame resumes its conversation. `Ctrl-b d` detaches while work continues. `make quit` asks before closing all frames; `make cleanup` does the same cleanup without confirmation and retains state and tools.

Use `PHILBY_DETACHED=1 make` to open without attaching. Terminal navigation, frame selection and workspace controls are documented in [tmux](tmux/README.md).

In Kitty on macOS, startup installs Cmd-Option-Right to move forward or open the frame selector, and Cmd-Option-Left to move back. Enable `allow_remote_control yes` in Kitty. Linux uses Ctrl-End and Ctrl-Home.

## Providers

Philby uses Pi's `ModelRuntime` for providers, authentication, model catalogs and request handling. Its native Pi configuration lives inside this checkout:

```text
.pi/agent/models.json        Custom providers, endpoints and model definitions
.pi/agent/auth.json          Pi-managed API keys and OAuth credentials
.pi/agent/models-store.json  Pi-managed catalog cache
.pi/agent/settings.json      Native Pi settings, including model shortlist and compaction
```

Every frame, consultation helper and provider command uses this directory. Philby sets `PI_CODING_AGENT_DIR` to its absolute path, overriding an inherited directory setting. File configuration is independent of `~/.pi/agent`; provider environment variables remain supported. Each checkout can configure its own providers, shared by all its frames. The `agent` subdirectory keeps Pi's agent settings separate from its project-level `.pi/settings.json`.

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

Set `enabledModels` in `.pi/agent/settings.json` to show a shortlist when opening `/model`. Entries use Pi's native exact IDs or wildcard patterns, such as `openrouter/z-ai/*` and `llama-local/**`. Use `**` when a model ID contains slashes. Press Tab in the picker to switch between `scoped` and `all` models. The full catalog stays available, and existing frame selections are preserved. With no shortlist, the picker shows all available models. Settings are read each time the picker opens; malformed settings and unmatched patterns are reported.

For a work gateway or local server, add its provider to `.pi/agent/models.json` using the standard [Pi model configuration](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md). The credential-free [models.json.example](models.json.example) shows a local OpenAI-compatible server. Merge the relevant entry into this checkout's `.pi/agent/models.json`, replace `your-loaded-model` with the exact server model ID, and set context/output limits to the server's actual capacity. The example's `local` key is a dummy value for an unauthenticated loopback server. For an authenticated gateway, use Pi's credential configuration or environment interpolation for the real key. Pi reserves 4,096 context tokens beyond its prompt estimate when limiting output. Size the server for Philby's instructions, conversation, that reserve and the reply; an 8,192-token context can leave only one output token. The example uses 32,768, which must match the actual server allocation.

Custom model IDs do not need to appear in Pi's bundled catalog. Use provider IDs such as `work` or `llama-local` consistently because saved frames retain their exact provider/model selection. Pi supplies built-in provider catalogs, caching, compatibility handling and supported discovery; a compatible endpoint's `/models` response does not necessarily include every piece of model metadata.

Native `modelThinkingLevels` in `.pi/agent/settings.json` supplies per-model thinking defaults, keyed by exact `provider/model-id`. Philby applies the target model’s configured level when selecting it, and on opening a frame whose saved conversation has no explicit thinking level. Explicit saved levels survive reopening. Pi clamps the level to the model’s supported capabilities.

Root `.env` selects the default for new frames with `DEFAULT_MODEL=provider/model-id`. The first slash separates the provider from the complete model ID. Each frame saves its selection in `frame.env`, validated against `shared/frame.env.schema`. Reopening uses that file even when the new-frame default has changed or is absent. An unavailable saved model is reported explicitly; Philby does not replace the conversation or silently choose another model. Model changes preserve conversation, memory and queued work.

Legacy root `*.provider` files and `.state/providers.sqlite` are no longer read. Configure the required providers through `make full-pi` and `.pi/agent/models.json` before reopening existing frames. Consultation helpers use the same runtime; they do not add synthetic model aliases.

## Configuration

[Varlock](https://varlock.dev/guides/schema/) validates configuration before a frame starts. Instance means this Philby checkout and its frames. The files have these roles:

| File | Purpose |
| --- | --- |
| `.env.schema` | Instance settings, types and nonsecret defaults |
| `.env` | Private instance values |
| `shared/frame.env.schema` | Standard schema for saved frame settings |
| `frames/<slug>/frame.env` | This frame's saved model and optional thinking preference |
| `frames/<slug>/.env.schema` | Additional schema for this frame's tools |
| `frames/<slug>/.env` | Private values for this frame's tools |

A saved settings file looks like:

```dotenv
FRAME_MODEL="openai/gpt-6.1-sol"
FRAME_THINKING_LEVEL=high
```

`FRAME_MODEL` is required. `FRAME_THINKING_LEVEL` accepts `off`, `minimal`, `low`, `medium`, `high`, `xhigh` or `max`; leaving it blank uses Pi's model thinking preference. Pi applies the model's capability limits. These settings are literal values, validated by the common schema. Unknown keys, duplicate keys and malformed values fail. Environment variables and private tool files cannot override saved frame settings.

`/model` updates `frame.env` atomically before applying the choice to the existing conversation. To save a thinking preference on a running frame, use `make frame-thinking slug=research LEVEL=high`; `LEVEL=default` clears that preference. Edit `frame.env` directly only while the frame is closed, then reopen it. Durable retains the active projection of these settings alongside its conversation state. The file is authoritative when reopening; conversation history, memory, plans, mailbox records and queued work remain in their existing stores.

For tool configuration, Varlock loads the instance directory followed by the frame directory. Frame values override instance values; explicit invocation environment variables take precedence over both. Varlock's `.env.local` and environment-specific file rules still apply. Philby passes explicit paths, including when `PHILBY_FRAMES_DIR` relocates frames. It tracks which environment values came from configuration so launching another frame does not turn the first frame's values into invocation overrides. Tmux launches use private environment snapshots, avoiding stale server values and keeping configuration values out of command arguments.

Define additional tool keys in the frame's `.env.schema`, for example:

```dotenv
# @defaultRequired=true
# @defaultSensitive=true

# @type=url
SERVICE_URL=

# @type=string
SERVICE_TOKEN=
```

Put the values in that frame's ignored `.env`. `PHILBY_*`, `PI_CODING_AGENT_DIR`, `FRAME_MODEL` and `FRAME_THINKING_LEVEL` are reserved in frame tool configuration. Philby controls frame identity, storage paths and the Pi directory. Schemas contain Varlock decorators; credential values belong in private files or Pi's credential store. Root and recipe schemas are tracked; `.env` files remain ignored. Pi continues to own provider definitions, login, token refresh, model catalogs and compaction.

```sh
make config-check
make frame-config-check slug=research
make frame-config-migrate slug=research
```

Checks print success or invalid key names without configuration values. The migration target requires a closed frame with a saved conversation and writes its exact saved model and explicit thinking preference to `frame.env`. It does not start a provider or resume work. Opening an existing frame without `frame.env` performs the same settings extraction under the frame's lifetime lock. A missing tool schema is added once during this upgrade; existing schemas, values and edited recipe files are preserved. After migration, a missing schema or malformed settings file is an error. No conversations are imported or replaced.

Frame startup validates tool configuration before recovering work. Tools and teardown receive the same resolved environment. Reopen a frame after changing its tool configuration; there is no hot reload in its running process. Consultation commands launched by its tools load that frame's configuration. Stop, close, status and mailbox commands do not load the frame's tool schema, so a broken frame configuration does not prevent controlling its existing process. Instance configuration must remain valid to locate frames.

## Compaction

Configure transcript compaction in `.pi/agent/settings.json` using Pi's native per-model settings. Merge the following example into the existing file for a model with a 32,768-token context:

```json
{
  "compaction": {
    "modelOverrides": {
      "llama-local/qwen/qwen3.8-flash-next-exp": {
        "reserveTokens": 8192,
        "keepRecentTokens": 12000
      }
    }
  }
}
```

Keys are exact `provider/model-id` values. Pi resolves each model's override over ordinary compaction settings and its defaults; project settings in the checkout's `.pi/settings.json` retain native precedence. This example triggers compaction above approximately 24k context tokens and retains approximately 12k recent tokens plus a summary.

Philby loads compaction settings when a frame process opens. Close and reopen the frame after editing them; switching models with `/model` applies the matching loaded profile. Explicit per-model profiles use foreground compaction. Philby supplies Durable's `backgroundTokens: 0` for those profiles; this is not a native `settings.json` field. Models without an explicit profile retain Durable's default background behaviour. Pi owns the compaction algorithm.

## Instructions and tools

[FRAME.md](FRAME.md) supplies the operating guidance shared by every frame. `frames/<slug>/SCOPE.md` defines that frame's standing purpose, responsibilities, boundaries and subject-specific conventions. Both files are read when the frame opens and included in model requests after compaction. Close and reopen to load edits. A scope is ordinary Markdown with no required sections; a new plain frame starts with an empty scope. Root and module `AGENTS.md` files guide software development and are not loaded as runtime frame instructions.

When upgrading an existing frame, rename its `AGENTS.md` to `SCOPE.md`, preserving the contents. If `SCOPE.md` already exists, inspect the files rather than overwriting it. A frame with only the old filename fails with a migration message; Philby does not fall back to it or replace it with a blank scope. This rename does not change its conversation or memory.

Every frame can use shared tools, even with an empty local toolset. Its first model request includes labeled literal sources from its Makefile and `shared/Makefile`. Both files are reread before every subsequent model request, including continuations after tool calls; changed sources refresh the supplied snapshots without reopening the frame. The latest snapshot is authoritative. Agents inspect these sources before building a capability and follow delegated Makefiles or scripts on demand.

Native `read`, `edit`, `write` and `bash` tools run in the frame's directory. Purpose-specific operations and diagnostics run through reusable Make targets: `make target` for frame tools or `make -C "$PHILBY_ROOT/shared" target` for shared tools. Namespaces organise tools; they are not a filesystem sandbox.

Frame types are creation recipes. `make frame slug=knowledge TYPE=graphwiki` creates a frame with graph tools; omitting `TYPE` creates a plain frame. Each recipe provides an initial `SCOPE.md`. Reopening preserves edited files and never reapplies the recipe. Requesting a different type for an existing frame fails. Creating a mailbox alone does not choose a type.

Graphwiki frames record all sourcing, attribution and references only in dated
journals at write time, then maintain concept articles as the wiki reading view.
Articles link to related concepts and retain material uncertainty; they contain
no provenance metadata, journal links or source narration. Journal entries link
to the articles they inform. The frame's `editorial-check` target checks common
provenance markers before publication and during `lint`; manual editorial review
is still required. See the recipe's [editorial interface](frame-types/graphwiki/EDITORIAL.md).
Existing frames need their scope and tools updated explicitly, then reopening to
load the new scope; creation recipes are never reapplied automatically.
Use `make browse` in a Graphwiki frame for the local read-only terminal browser.
Wiki and Journal views have clickable links and backlinks. No web service starts
when a frame opens. Frame-specific HTML previews remain ordinary local tools.
See the [graphwiki module](shared/graphwiki/README.md) for terminal controls.

An optional nonempty `BOOT.md` queues an opening checklist behind recovered work. Its unfinished task resumes without duplicate submission. A frame with `BOOT.md` must supply a `make close` target for teardown. Closure suspends Durable work first, then awaits teardown with a 60-second deadline. Failures are reported while application resources are released. Detaching leaves work running.

All frame directories are private and ignored by this repository. Clone or create independent frame repositories at `frames/<slug>` as needed, keeping `.state/` ignored there too. Creating a frame does not automatically initialise a Git repository.

## Conversation, memory and messages

Enter submits, Shift-Enter inserts a newline, and follow-ups queue while work is running. Escape or `/stop` cancels current work while preserving queued input. Philby does not automatically restart queued input after a stop or failed run; a new input can advance it through Pi’s normal submission handling. `/steer message` steers at the next model boundary. Ctrl-O expands tool output.

| Command | Operation |
| --- | --- |
| `/model` | Select and save this frame's model |
| `/memory`, `/memory notes` | Inspect or edit durable memory |
| `/tools` | Inspect frame and shared Makefiles |
| `/updates` | Read and mark passive reports |
| `/send slug message` | Queue input in the receiving frame |
| `/report slug message` | Record a passive update in the receiving frame |
| `/plan`, `/plan on`, `/plan off [plan]` | Read-only plan mode: research and present a plan before editing |
| `/new` | Start a fresh session, preserving files, tools, memory and archived history |
| `/close`, `/quit` | Suspend this frame or confirm closing the workspace |

Memory fields are `responsibilities`, `notes`, `decisions`, `outstanding` and `sources`. They live separately from the transcript and enter model requests after compaction. `SCOPE.md` is the standing definition of the frame's remit; memory holds learned facts, decisions and working context. The existing `responsibilities` field and its saved contents remain available without copying the scope into it. Model changes preserve conversation, memory and queued work.

Plan mode restricts the frame to read-only operations. While active, the model can use the native `read` tool to examine files but cannot edit files or run shell commands. The header shows `PLAN MODE` when active. Entering plan mode requires no active work; exit with `/plan off` to resume normal operation. An approved plan supplied at exit is included in subsequent model context.

```sh
make frame-plan slug=research
make frame-plan-set slug=research ACTIVE=1
make frame-plan-set slug=research ACTIVE=0 PLAN='1. Implement the feature'
printf '1. Step one\n2. Step two\n' | make frame-plan-set slug=research ACTIVE=0
```

`ACTIVE` must be exactly `0`, `1`, `true`, or `false`. A nonempty `PLAN` supplies the approved plan; otherwise use the usual `PROMPT_FILE`, `PROMPT`/`prompt`, then stdin precedence. Exiting without replacement text preserves any previously saved plan. Reads of explicit prompt files fail visibly if unavailable.

`/new` starts a fresh model context in the existing Durable conversation while retaining prior transcript entries, files, tools, instructions, durable memory and model selection. Plan mode begins off with no approved plan in the fresh context. `/new` rejects while work is active, queued or awaiting mailbox delivery; it does not cancel work. Reopening preserves the fresh context. Add `ALL=1` to capture the full archived history in chronological order.

```sh
make frame-new-session slug=research
make frame-capture slug=research ALL=1
```

```sh
make frame-memory slug=research FIELD=notes PROMPT_FILE=/absolute/path/notes.txt
make frame-send slug=research from=work REQUEST_ID=research-001 PROMPT_FILE=/absolute/path/request.txt
printf 'First line\nSecond line\n' | make frame-send slug=research from=work
make frame-report slug=work from=research prompt='Review complete'
make frame-updates slug=work MARK=1
make frame-capture slug=research
```

Prompt precedence is `PROMPT_FILE`, `PROMPT`/`prompt`, then stdin. Files and stdin preserve multiline content and shell metacharacters. Relative paths use the command's working directory; use absolute paths with `make -C`. Failures return nonzero. Capture returns the active transcript as JSON, even for a closed frame; treat that output as private.

Messages and reports require `slug` to identify the receiving frame. `from` identifies the sender; inside a frame it can be inferred from `PHILBY_FRAME`, while commands run outside a frame must supply it. Acceptance means the receiving mailbox transaction has committed, including when that frame is closed. It does not mean the work is complete. Reuse the same stable `REQUEST_ID` for retries. Conflicting content for an ID is rejected within the receiving frame; there is no global ID registry. Reports remain passive.

## Modules

| Location | Responsibility | Documentation |
| --- | --- | --- |
| `src/`, `test/` | Conversations, memory, mailboxes, CLI and TUI | This README |
| `tmux/` | Workspace adapter, configuration and terminal integration tests | [tmux](tmux/README.md) |
| `shared/browser/` | Puppeteer tools for existing Chrome and Firefox sessions | [Browser](shared/browser/README.md) |
| `shared/ocr/` | Local English text extraction from screenshots and PDFs | [OCR](shared/ocr/README.md) |
| `shared/slides/` | Local PPTX generation with PptxGenJS | [Slides](shared/slides/README.md) |
| `shared/google-workspace/` | Read-only Google Chat, Docs, Sheets, Slides and Drive tools using gogcli | [Google Workspace](shared/google-workspace/README.md) |
| `shared/graphwiki/` | Graph operations, command wrapper and Rust tests | [Graphwiki](shared/graphwiki/README.md) |

The tmux adapter builds with the core. Browser tools have their own TypeScript build; OCR and slides run as Node scripts. These modules reuse the root npm dependencies, including `puppeteer-core`, `scribe.js-ocr`, English OCR assets and `pptxgenjs`. Graphwiki owns its Cargo lockfile. Plain frames do not require a browser or Rust.

`shared/Makefile` exposes `browser-connect`, `browser-disconnect`, `browser-status`, `browser-tabs` and `browser-run`, plus the `wiki-*` tools. Run `make -C shared help` to discover them. Browser tools require `BROWSER=chrome|firefox` and an existing browser prepared for remote control. `browser-connect` opens a dedicated tmux service pane that owns one persistent Puppeteer connection; Chrome approval is needed when that connection starts. Later commands reuse it, preserving the browser's profile. `browser-run` executes a standard Puppeteer async function body supplied through a prompt file, `prompt`, or stdin. See the [browser setup and examples](shared/browser/README.md). Graphwiki requires Rust, Cargo and `flock`.

The browser service survives detaching and closing ordinary agent frames while idle. `browser-disconnect`, closing its service pane, or workspace cleanup stops it while leaving the browser and tabs open. A per-user lock prevents another workspace from controlling the same browser. Browser operations queue; status bypasses the queue. Cancelling an active request stops the service and fails pending requests. Services never start implicitly, time out while idle, restart automatically or replay scripts.

Shared `ocr` reads one complete local PDF, PNG or JPEG and writes English text to stdout, preserving page boundaries. Use `make -C shared ocr INPUT=/absolute/path/document.pdf`; add `OUTPUT=/absolute/path/new-text.txt` to create a file without overwriting an existing one. It runs directly with local model assets and exits after cleanup. `ocr-diagnose` checks dependencies without reading a document. Download or export browser files separately before invoking OCR. See [OCR usage and limitations](shared/ocr/README.md).

Shared `ask`, `reason` and `twitter` provide fresh consultations without local tools or frame context. They share the instance provider configuration and the same prompt inputs. Override `ASK_MODEL`, `REASON_MODEL` or `TWITTER_MODEL` in root `.env` or the command environment using `provider/model-id`. Their defaults are `openrouter/z-ai/glm-5.2`, `openrouter/openai/gpt-5.5`, and `openrouter/x-ai/grok-4.3`, respectively. The selected model must be available through Pi.

Shared `slides-generate` creates a local PPTX from an asynchronous JavaScript body receiving a PptxGenJS `pptx` instance. Use `make -C shared slides-generate PROMPT_FILE=/absolute/path/deck.js OUTPUT=/absolute/path/deck-v1.pptx`. The wrapper saves the result exclusively; choose a new output filename for each revision. Branding, masters and layout functions belong in the calling frame's source. `slides-diagnose` verifies local serialization without a browser, model provider or Google account. See [Slides usage and example](shared/slides/README.md).

Shared `google-workspace-*` targets read Google Chat, Docs, Sheets, Slides and Drive through the current `gog` on `PATH`. The macOS `core-tools` role in `../setup-system` installs the latest gogcli through `make setup`; Philby neither vendors nor pins the client and has no runtime dependency on that checkout. Supply `GOOGLE_ACCOUNT=email` on data commands. `google-workspace-read URL=...` reads a document, `google-workspace-spaces` lists Chat spaces, and `google-workspace-messages SPACE=spaces/...` reads messages. `google-workspace-export` and `google-workspace-download` create private output files without overwriting existing files. Authentication explicitly selects gog's `default` OAuth client and combined read-only service authorization. See [Google Workspace setup, inputs and verification](shared/google-workspace/README.md).

## State and verification

Each frame lives entirely under `frames/<slug>/`: its scope, Makefile, tools, working files and private `.state/` directory. `.state/durable.sqlite` stores conversation, memory and task state; `.state/app.sqlite` stores mailbox records and reports. Each slug has one application process and Durable store. A SQLite lifetime lock prevents duplicate owners; private Unix sockets carry local commands.

### Renaming existing panes to frames

A frame is Philby's persistent conversational operator and its complete working context: scope, tools, memory, conversation and mailbox. The name replaces Philby's former “pane”; tmux still calls its terminal subdivisions panes.

```sh
make frame-migrate
```

This renames the existing `panes/` tree to `frames/` in place, changes `.pane-type` markers to `.frame-type`, and updates terminology and Philby command/path references in local Markdown, Makefiles and source scripts. Edited tools and working files remain in place. Private `.state/` directories, saved conversations, memory, archived sessions, mailbox records and request IDs are not rewritten or imported. Symlinks and binary artifacts are left untouched. Destination or marker collisions fail explicitly rather than merging or overwriting data.

Close existing operators and browser services before migrating, then reopen with `make frame slug=<slug>`. If migrating from the operator performing this refactor, finish the turn, close that old process and reopen it before further work; running processes retain their old working paths and environment. Update external shell configuration from `PHILBY_PANE` / `PHILBY_PANES_DIR` to `PHILBY_FRAME` / `PHILBY_FRAMES_DIR`. Old command aliases are not retained.

For a relocated tree, use `make frame-migrate INPUT=/absolute/old-directory PHILBY_FRAMES_DIR=/absolute/new-directory`. The default source is this checkout's `panes/`, not the obsolete environment variable. Back up closed operators before migration. Historical transcript text retains its original wording.

`PHILBY_FRAMES_DIR` relocates the complete frame directory tree, including state. `PHILBY_HOME` is no longer supported and is rejected. `PHILBY_TMUX_SOCKET` isolates the tmux server. Tests use temporary directories and deterministic providers. Unsafe interrupted tools are reported rather than replayed automatically. Back up frame directories with frames closed or with SQLite-aware tooling.

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

Core checks need no browser or Rust toolchain. `make check-all test-all` runs the aggregate checks and suites. Existing tests cover persistence, message delivery, memory, instructions, recovery, frame recipes and module behaviour. Terminal tests require util-linux `script` on Linux or the system `script` on macOS. Frame-specific workflows are verified through their own Make targets. `make ingest` copies the existing tracked-file digest to the desktop clipboard.
It uses `pbcopy` on macOS, `wl-copy` when Linux has `WAYLAND_DISPLAY`, or
`xclip -selection clipboard` when Linux has only `DISPLAY`. Install `wl-clipboard`
for Wayland or `xclip` for X11. A headless Linux session fails explicitly. A missing
or failing selected command is reported; no other backend is tried. The digest
must finish successfully before the clipboard is touched.

Linux verification of the browser and OCR modules is pending a separate session; [linux.txt](linux.txt) records the checks to run and results to collect.

## License

Philby is licensed under the GNU Affero General Public License, version 3 only (`AGPL-3.0-only`). See [LICENSE](LICENSE).
