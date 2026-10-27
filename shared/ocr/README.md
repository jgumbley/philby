# OCR

Extract English text from one local PDF, PNG or JPEG through a direct Make command. OCR uses pinned `scribe.js-ocr` 0.17.0 and the local English model from `@tesseract.js-data/eng` 1.0.0. `make deps` installs both through the root npm lockfile. Recognition runs locally without downloading models.

```sh
make -C shared ocr-diagnose
make -C shared ocr INPUT=/absolute/path/document.pdf
make -C shared ocr INPUT=/absolute/path/screenshot.png OUTPUT=/absolute/path/new-text.txt
```

Run these commands from the repository root. From a pane, use `make -C "$PHILBY_ROOT/shared"` with the same target and arguments. Use absolute paths with `make -C`. Supported input extensions are `.pdf`, `.png`, `.jpg` and `.jpeg`; the input must be one complete local file. English is the only configured recognition language.

Without `OUTPUT`, `ocr` writes plain text to stdout. With `OUTPUT`, it creates that text file exclusively and fails if the destination already exists. Text keeps repeated lines and blank pages. Pages are separated by a newline, a form-feed character and another newline (`\n\f\n`). Progress and errors go to stderr. Failures, including a document with no extracted text, return nonzero.

PDF import extracts existing native text. Recognition uses Scribe's `autoShallow` page selection to OCR scanned pages within mixed documents while retaining ordinary native-text pages. Existing invisible OCR text is reprocessed by default. This does not extract text from small embedded images within otherwise native-text pages. Page classification and recognition are heuristic; inspect important results against the source.

Capture a screenshot or finish downloading/exporting a PDF before invoking OCR. Existing `browser-run` can perform the application-specific browser operation; OCR reads the resulting local file. It does not manage browser downloads.

Each invocation runs one process with two OCR workers and releases Scribe resources when it finishes or fails. Model decompression uses a disposable scratch directory that is cleaned up, leaving no model cache in the caller's directory. There is no daemon, service pane, socket or configured execution deadline.

`ocr-diagnose` reports platform/runtime information and checks the Scribe/native-canvas dependency and local English assets without opening a document. It is a dependency diagnostic, not service status.

## Checks

```sh
make -C shared ocr-check ocr-test
make -C shared/ocr check test
```

On 2026-10-27, diagnostics, syntax checks and all seven OCR integration tests passed on macOS arm64 with Node 24.10.0. The tests use generated PNG/JPEG and native, scanned and mixed PDFs, with network access blocked. They cover repeated text, blank pages, literal filenames, exclusive output and concurrent process cleanup. Core checks and all 55 application tests also passed. Linux verification is pending a separate session; [linux.txt](../../linux.txt) lists the required checks. Fixture results do not establish accuracy on every document.

Scribe is licensed under AGPL-3.0; its native canvas dependency is MIT-licensed. See the installed packages for their license texts. The [Scribe guide](https://github.com/scribeocr/scribe.js/blob/master/docs/guide.md) documents the underlying API.
