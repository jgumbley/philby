# Google Workspace

Read Google Chat, Docs, Sheets, Slides and Drive from any Philby frame through `shared/Makefile`. The module wraps the current [gogcli](https://github.com/openclaw/gogcli) executable on `PATH`. It uses Node's standard library; no Python environment, vendored client, pinned client version or sibling checkout is required.

## Setup and authentication

On the managed macOS workstation, install the latest gogcli through the `core-tools` role in the sibling `setup-system` repository:

```sh
make -C ../setup-system setup
make -C shared google-workspace-diagnose
```

For other installations, follow the current [gogcli installation instructions](https://github.com/openclaw/gogcli) and ensure `gog` is on `PATH`. Philby neither installs the client nor calls `setup-system` at runtime. Diagnostics report the installed client and local authentication metadata, without reading a Google document or printing tokens. Add `GOOGLE_ACCOUNT=you@example.com` to inspect that account's registration.

If gog already has the required OAuth client and user authorization, use them directly. Otherwise register a Google OAuth desktop-client JSON file and sign in from an interactive terminal:

```sh
make -C shared google-workspace-credentials CREDENTIALS_FILE=/absolute/path/client.json
make -C shared google-workspace-login GOOGLE_ACCOUNT=you@example.com
```

Login requests read-only access to `chat,drive,docs,sheets,slides`. All commands explicitly select gog's `default` OAuth client and use its existing configuration and credential store. Philby does not copy tokens, read account settings from another checkout, or infer which Google account to use. Keep the OAuth JSON file outside the repository. Each data operation requires `GOOGLE_ACCOUNT`, supplied as a Make argument or exported in the calling environment. An inaccessible file, missing authorization or unsupported client response fails visibly.

## Read documents

```sh
make -C shared google-workspace-read GOOGLE_ACCOUNT=you@example.com \
  URL='https://docs.google.com/document/d/FILE_ID/edit'

make -C shared google-workspace-read GOOGLE_ACCOUNT=you@example.com \
  URL='https://docs.google.com/spreadsheets/d/FILE_ID/edit' RANGE='Sheet1!A1:Z20'

make -C shared google-workspace-read GOOGLE_ACCOUNT=you@example.com \
  URL='https://docs.google.com/presentation/d/FILE_ID/edit' OUTPUT=/absolute/path/new-slides.txt
```

Docs include all tabs. Sheets return the selected A1 range as tab-separated rows, or a CSV export of the first worksheet when no range is supplied. Use `RANGE` to select another worksheet. Slides include text and speaker notes in slide order. Drive URLs and bare file IDs are resolved through file metadata to the matching Workspace reader. Unsupported binary documents must be downloaded explicitly; they are not decoded as document text.

`MAX_BYTES` bounds content bytes and defaults to `100000`; a visible truncation marker is added after the bounded content when needed. `MAX_SLIDES` bounds Slides extraction and defaults to `40`. Use a bounded Sheets range for large spreadsheets.

The URL input order is `URL`, then `PROMPT_FILE`, `prompt`/`PROMPT`, then stdin. Prompt files and stdin contain one URL or file ID. Missing prompt files fail immediately. For example:

```sh
make -C shared google-workspace-read GOOGLE_ACCOUNT=you@example.com PROMPT_FILE=/absolute/path/document-url.txt
printf '%s\n' 'https://docs.google.com/document/d/FILE_ID/edit' | \
  make -C shared google-workspace-read GOOGLE_ACCOUNT=you@example.com
```

## Read and export Chat

```sh
make -C shared google-workspace-spaces GOOGLE_ACCOUNT=you@example.com
make -C shared google-workspace-spaces GOOGLE_ACCOUNT=you@example.com TYPE=direct
make -C shared google-workspace-messages GOOGLE_ACCOUNT=you@example.com SPACE=spaces/SPACE_ID
make -C shared google-workspace-export GOOGLE_ACCOUNT=you@example.com \
  SPACE=spaces/SPACE_ID SINCE=2026-10-01T00:00:00Z OUTPUT=/absolute/path/new-chat.json
```

Space listings include last-message times and support `TYPE=all|space|direct|group`, defaulting to `all`. Messages are returned chronologically. Export requires an explicit RFC3339 timestamp and writes messages since that timestamp with export metadata. Chat results are JSON. Use the resource identifier returned by the spaces listing as `SPACE`.

The current gog `chat dm space` command can create a conversation, so this read-only module does not expose it. Find an existing DM through `google-workspace-spaces TYPE=direct` and use its space identifier.

## Files and output

```sh
make -C shared google-workspace-download GOOGLE_ACCOUNT=you@example.com \
  URL='https://drive.google.com/file/d/FILE_ID/view' OUTPUT=/absolute/path/new-file.pdf
```

`download` and `export` require `OUTPUT`. `read`, `spaces` and `messages` print their result to stdout unless `OUTPUT` is supplied. New files are created with owner-only permissions, and existing files or symlinks are never overwritten. Parent directories must already exist. Diagnostics and errors stay separate from result data.

Relative paths use Make's working directory. Use absolute paths with `make -C shared`, or preserve the frame directory with `make -f "$PHILBY_ROOT/shared/Makefile" google-workspace-read ...`.

All Google data commands use gog's read-only, noninteractive mode. The module does not expose arbitrary gog commands. Read-only authorization does not change Philby's replay rules for native tools. Downloads and authentication retain their usual side effects and must not be marked replay-safe.

## Verification

```sh
make -C shared/google-workspace check test
make -C shared google-workspace-diagnose GOOGLE_ACCOUNT=you@example.com
```

Automated tests use deterministic client fixtures and temporary output directories. They exercise the shared interface, parsing, limits, failure propagation and file handling without contacting Google or using real credentials. `make check-all test-all` includes this module.

After installation or a gog upgrade, manually run the Make targets above against accessible sample Docs, Sheets, Slides, a Drive file and a Chat space. Confirm chronological Chat output, bounded text, saved-file contents and explicit failures for inaccessible inputs. Keep frame-specific research and JIRA workflows in their owning frames.
