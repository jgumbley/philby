# Philby

Philby is a general-purpose working environment for persistent agents. Work is organised into panes, each with a continuing conversation, memory, instructions and tools. Return to a pane to inspect its work and change its direction. Its work survives closing and reopening it.

The kernel provides continuity, communication and control. Panes build small reusable tools for their responsibilities and expose them through Make. You decide what the panes are for and steer their work.

## Start

Use Node 22.19 or newer, npm, GNU Make, bash and tmux on Linux. Clone this repository, enter its directory, then:

```sh
make provider-setup
```

Set `API_KEY` in the generated `openrouter.provider`. The generated `.env` selects `DEFAULT_MODEL=openrouter/moonshotai/kimi-k3` for new panes. Setup reports missing credentials; it does not log in or call a model.

```sh
make deps
make
```

`make deps` installs the pinned npm lockfile. `make` builds the application and opens the create/open pane screen in tmux. With no existing panes it starts at pane creation; no agent starts until you create or select a pane. Every pane is an ordinary workspace, with no built-in coordinator. `/model` selects and saves a pane's model. Saved panes retain their selection when reopened. Unknown models and missing credentials fail explicitly; Philby does not substitute another model.

```sh
make pane slug=research
make pane-new
make pane-list
make pane-close slug=research
make quit
```

Slugs are immutable and unique: 1–64 lowercase letters, digits or hyphens, beginning with an alphanumeric character. Opening a running pane focuses it; opening a closed pane resumes its conversation. `Ctrl-b d` detaches while work continues. `make quit` asks before closing all panes; `make cleanup` does the same cleanup without confirmation and retains state and tools.

Use `PHILBY_DETACHED=1 make` to open without attaching. Terminal navigation, pane selection and workspace controls are documented in [tmux](tmux/README.md).

## Providers

Philby discovers root-level `*.provider` files in filename order. The filename identifies the provider: `openrouter.provider` supplies `openrouter`; `work.provider` supplies `work`. Each file uses dotenv syntax and is parsed independently as data, without shell execution or variable expansion. Provider files contain credentials and are ignored by Git; commit only credential-free `*.provider.example` templates.

```dotenv
TYPE=openrouter
API_KEY=your-key
MODELS=moonshotai/kimi-k3,z-ai/glm-5.2,z-ai/glm-5.3
```

`TYPE`, `API_KEY` and `MODELS` are required. Supported types are `openrouter` and `openai-compatible`; Codex sign-in is not implemented. Multiple provider files can use the same type with separate keys. Unsupported settings, types and model IDs fail explicitly. Provider loading uses the installed model catalog without network discovery.

For an OpenAI-compatible gateway, copy `gateway.provider.example` to a named provider file. Set `BASE_URL` to the API prefix before `/chat/completions`, and `CATALOG` to the Pi catalog containing the exact IDs in `MODELS` (for example `anthropic`). Pi supplies model names, context/output limits and cost estimates; the estimates are not gateway billing rates. The adapter uses text chat and function tools, without provider-specific thinking controls. Unknown catalog entries fail instead of inventing limits. `make -C shared provider-models PROVIDER=name` lists the gateway's `/models` response using that file's credentials.

`MODELS` is an ordered, comma-separated model picker list. OpenRouter's complete supported catalog remains available to saved selections and explicit consultation requests; gateways expose only the listed models. Labels and model metadata come from the installed library, with the existing DeepSeek October 17 metadata adjustment retained for OpenRouter. Explicit OpenRouter `:online` variants remain supported. Research requires OpenRouter's web tools and rejects gateway models.

Root `.env` selects the default with `DEFAULT_MODEL=provider/model-id`. The first slash separates provider identity from the full model ID, so `openrouter/z-ai/glm-5.3` selects GLM 5.3. Changing the default affects new panes; existing panes retain their saved provider and model. Keep provider filenames stable: removing or renaming a saved pane's provider causes an explicit startup error without replacing its conversation. Close and reopen panes to load configuration changes.

`make provider-setup` copies `.env.example` and `openrouter.provider.example` to their runtime filenames when missing. Existing files are left untouched. There is no automatic migration: put credentials in the provider file and use `DEFAULT_MODEL` in `.env`. `OPENROUTER_API_KEY` and `PI_MODEL_ID` are no longer runtime settings. Provider files are reread when panes start; restart Philby after changing instance settings.

## Instructions and tools

[PANE.md](PANE.md) supplies the operating guidance shared by every pane. `panes/<slug>/SCOPE.md` defines that pane's standing purpose, responsibilities, boundaries and subject-specific conventions. Both files are read when the pane opens and included in model requests after compaction. Close and reopen to load edits. A scope is ordinary Markdown with no required sections; a new plain pane starts with an empty scope. Root and module `AGENTS.md` files guide software development and are not loaded as runtime pane instructions.

When upgrading an existing pane, rename its `AGENTS.md` to `SCOPE.md`, preserving the contents. If `SCOPE.md` already exists, inspect the files rather than overwriting it. A pane with only the old filename fails with a migration message; Philby does not fall back to it or replace it with a blank scope. This rename does not change its conversation or memory.

Every pane can use shared tools, even with an empty local toolset. Its first model request includes labeled literal sources from its Makefile and `shared/Makefile`. Both files are reread before every subsequent model request, including continuations after tool calls; changed sources refresh the supplied snapshots without reopening the pane. The latest snapshot is authoritative. Agents inspect these sources before building a capability and follow delegated Makefiles or scripts on demand.

Native `read`, `edit`, `write` and `bash` tools run in the pane's directory. Purpose-specific operations and diagnostics run through reusable Make targets: `make target` for pane tools or `make -C "$PHILBY_ROOT/shared" target` for shared tools. Namespaces organise tools; they are not a filesystem sandbox.

Pane types are creation recipes. `make pane slug=knowledge TYPE=graphwiki` creates a pane with graph tools; omitting `TYPE` creates a plain pane. Each recipe provides an initial `SCOPE.md`. Reopening preserves edited files and never reapplies the recipe. Requesting a different type for an existing pane fails. Creating a mailbox alone does not choose a type.

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
| `shared/firefox/` | Browser tools, build and integration tests | [Firefox](shared/firefox/README.md) |
| `shared/graphwiki/` | Graph operations, command wrapper and Rust tests | [Graphwiki](shared/graphwiki/README.md) |

The tmux adapter builds with the core. Firefox has its own TypeScript build and reuses the root npm dependencies. Graphwiki owns its Cargo lockfile. Plain panes do not require Firefox or Rust.

`shared/Makefile` retains `browser-*` and `wiki-*` entrypoints and delegates to the modules. Run `make -C shared help` to discover them. Graphwiki requires Rust, Cargo and `flock`; Firefox tools require Firefox and `flock`, with Sway needed for marked desktop windows. Each module documents its requirements.

Shared `ask`, `reason` and `twitter` provide fresh consultations without local tools or pane context. Shared `research` searches and reads web pages using OpenRouter's web tools. They share the instance provider configuration and the same prompt inputs. Override `ASK_MODEL`, `REASON_MODEL`, `TWITTER_MODEL` or `RESEARCH_MODEL` in root `.env` or the command environment using `provider/model-id`. Their defaults are `openrouter/z-ai/glm-5.2`, `openrouter/openai/gpt-5.5`, `openrouter/x-ai/grok-4.3:online` and `openrouter/openai/gpt-5.5`, respectively. Research uses the selected provider's key and OpenRouter web tools; omit `:online` from its model reference. Ordinary consultations retain explicit `:online` support.

## State and verification

Each pane lives entirely under `panes/<slug>/`: its scope, Makefile, tools, working files and private `.state/` directory. `.state/durable.sqlite` stores conversation, memory and task state; `.state/app.sqlite` stores mailbox records and reports. Each slug has one application process and Durable store. A SQLite lifetime lock prevents duplicate owners; private Unix sockets carry local commands.

`PHILBY_PANES_DIR` relocates the complete pane directory tree, including state. `PHILBY_HOME` is no longer supported and is rejected. `PHILBY_TMUX_SOCKET` isolates the tmux server. Tests use temporary directories and deterministic providers. Unsafe interrupted tools are reported rather than replayed automatically. Back up pane directories with panes closed or with SQLite-aware tooling.

When upgrading from the separate `.philby/` state tree, close all old pane processes first, then run `make -C shared migrate-state`. It moves `.philby/panes/<slug>/` into each pane's `.state/` and removes the former unused `philby` coordinator. Run this before reopening panes with the new layout.

For an installation with legacy outboxes: close panes with `make cleanup`, run `make migrate-mailboxes`, then repeat it to confirm zero pending migrations before reopening. Migration preserves receiving mailboxes, conversations and report read state. Keep older processes stopped during migration.

```sh
make help
make digest
make check
make test
make -C tmux test
make -C shared/firefox check test
make -C shared/graphwiki check test
```

Core checks need no browser or Rust toolchain. `make check-all test-all` runs the aggregate checks and suites. Existing tests cover persistence, message delivery, memory, instructions, recovery, pane recipes and module behaviour. Terminal tests require util-linux `script` on Linux or the system `script` on macOS. Pane-specific workflows are verified through their own Make targets. `make ingest` copies the tracked digest using the optional Wayland `wl-copy` command.

## License

Philby is licensed under the GNU Affero General Public License, version 3 only (`AGPL-3.0-only`). See [LICENSE](LICENSE).
