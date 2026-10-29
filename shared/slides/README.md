# Slides

Generate local PowerPoint presentations with PptxGenJS through Make. Each invocation runs one Node process, executes your slide-building JavaScript, and saves a new `.pptx` file. PowerPoint, a browser and a Google account are not required for generation. Google Slides upload, conversion, comments and editing are outside this tool.

```sh
make -C shared slides-diagnose
make -C shared slides-generate \
  PROMPT_FILE=/absolute/path/deck.js OUTPUT=/absolute/path/deck-v1.pptx
make -C shared slides-check slides-test
```

The module also exposes the same operations directly:

```sh
make -C shared/slides diagnose
make -C shared/slides generate \
  PROMPT_FILE=/absolute/path/deck.js OUTPUT=/absolute/path/deck-v1.pptx
make -C shared/slides check test
```

`make deps` installs PptxGenJS 4.0.1 through the root npm lockfile. A version-scoped override pins its `image-size` dependency to patched 2.0.4; the PptxGenJS 4.0.1 bundles do not call that dependency. `diagnose` checks the runtime and library by serializing a small presentation in memory and reports JSON to stdout; it does not create a deck.

## Input and output

Supply a nonempty async JavaScript function body through `PROMPT_FILE`, `PROMPT`/`prompt`, or stdin, in that order. An explicit unreadable prompt file fails instead of trying another input. The body receives one initialized `pptx` instance and uses the native [PptxGenJS API](https://gitbrent.github.io/PptxGenJS/docs/api-slides/) to add slides, masters, text, shapes and images. Plain functions and `await` are supported. Do not call `write` or `writeFile`: the wrapper saves the presentation after your body completes.

```sh
printf '%s\n' 'pptx.addSlide().addText("Hello", { x: 1, y: 1, w: 8, h: 1 });' \
  | make -C shared slides-generate OUTPUT=/absolute/path/hello.pptx
```

`OUTPUT` is mandatory and must name a new `.pptx` file in an existing directory. Existing files and symlinks are rejected; there is no overwrite option. Successful generation writes one JSON object to stdout: `{"output":"/absolute/path/deck-v1.pptx"}`. During generation, script output and library diagnostics go to stderr. Errors go to stderr and missing input, invalid JavaScript, failed generation and failed writes exit nonzero.

Paths retain the invoking process's working directory. The location of `PROMPT_FILE` does not change relative image, input or output paths. `make -C shared` makes `shared` the working directory, so use absolute paths there. From a pane, preserve its directory with:

```sh
make -f "$PHILBY_ROOT/shared/Makefile" slides-generate \
  PROMPT_FILE=deck.js OUTPUT=deck-v2.pptx
```

The source is a function body, not an ES module: static `import` and `export` declarations are not supported. Use plain layout functions or `await import(...)` with an absolute file URL for reusable local modules. Scripts execute with the caller's Node permissions.

## Branding and iteration

Keep brand colours, fonts, layout helpers, assets and deck source in the pane that owns the work. The tool supplies no brand or content schema. PptxGenJS's default layout is 10 × 5.625 inches; choose another layout explicitly in your source when needed.

[examples/branded.js](examples/branded.js) demonstrates two slides sharing a master, colours, fonts and a layout helper without external assets. From the repository root:

```sh
make -f shared/Makefile slides-generate \
  PROMPT_FILE=shared/slides/examples/branded.js OUTPUT=/tmp/philby-branded-v1.pptx
```

Choose a fresh output name for every revision. To verify appearance, open the generated example in your presentation editor and inspect text fit, fonts, colours and slide order. Module checks cover generation mechanics; they do not establish rendering fidelity in a particular editor.
