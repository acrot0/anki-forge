# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.9.0] — 2026-09-25

### Added

- **Folder import** — `anki-forge import ./高数上学期/ --deck "考研::数学"`: directories
  expand recursively into supported files; `node_modules`, hidden and dot dirs are
  skipped, and an empty folder names itself in the error.
- **Rate-limit backoff** — HTTP 429 now waits (Retry-After header, else
  exponential) before retrying, with a third attempt reserved for it; non-429
  failures keep the old two-attempt budget.
- **`--max-total N`** — a global card cap, so one oversized folder cannot flood
  a deck.

## [0.8.0] — 2026-09-25

### Added

- **In-Anki card styling** — generated decks now ship a styled notetype:
  centered layout, dashed answer divider, tag chips, cloze highlighting, and
  automatic dark mode via Anki's `nightMode` class. Review looks like the
  app, not like a default template.

## [0.7.0] — 2026-09-25

### Added

- **Card content quality** — the generation prompts now steer toward
  exam-oriented angles (definition / cause / contrast / mechanism / numbers /
  exceptions), demand a direct-answer-first back, and keep English terms
  untranslated inside non-English text. Each card carries its source section
  as an Anki tag, so review can trace a fact back to where it came from.
- **UI redesign**: gradient hero with capability badges, dark mode following
  the system, stat tiles (cards / sections / cache hits), and per-chunk
  status with cache-hit marks.
- **Flashcard flip preview** — click a card to 3D-flip it and see the answer
  plus its source section, mirroring how Anki will quiz you.
- **Motion pass** — staggered panel/card entrances, flowing progress-bar
  shimmer, skeleton placeholders while generating, hover lifts, and an
  animated empty state.

## [0.6.0] — 2026-09-25

### Added

- **Graphical UI** (`anki-forge ui`) — a local web app embedded in the
  binary: drag files in, pick a provider, watch per-chunk progress, preview
  every generated card, then download the .apkg, write to Anki, or export
  TSV — no terminal literacy required. Loopback-only, zero new dependencies,
  and it shares the exact generation path and cache with the CLI.

## [0.5.0] — 2026-09-25

### Added

- **Installer scripts** (`install.ps1` / `install.sh`) — download the
  self-contained release binary into `~/.local/bin` without npm or Node.
  npm is no longer the recommended path: npm 12 refuses `github:` and
  remote-tarball installs by default (EALLOWREMOTE), and there is no npm
  account behind this project.
- **`.xlsx` support** — vocab lists and glossaries: one row per line, cells
  joined with ` | `, shared strings and inline/numeric cells handled.
- **Proxy hint on network failures** — "fetch failed" now explains how to
  set `HTTPS_PROXY` instead of leaving an opaque error.
- **Wizard retries** — a typo in provider/style/files is re-asked (3 tries)
  instead of aborting after five answered questions.
- **Bulk insert transaction** for .apkg writes — large decks build in
  seconds instead of paying a fsync per note.

## [0.4.0] — 2026-09-25

### Added

- **`.apkg` export** (`--export deck.apkg`) — a real Anki deck file (schema
  11, built with Node's built-in SQLite): import on any device, share it, no
  running desktop app needed. The target deck ships inside the file.
- **`.docx` support** — Word documents parsed per paragraph; run boundaries
  (spell-check splits) preserve their inter-word spaces.
- **Parallel generation** (`--concurrency N`, default 4) — chunks are now
  processed concurrently instead of one at a time; large decks finish in a
  fraction of the previous wall clock.
- **Progress bar** on generation (TTY-aware; pipes stay quiet).

### Fixed

- TSV export used a newline as the field separator — files exported by 0.3.0
  import as one column. Now tab-separated as documented.

## [0.3.0] — 2026-09-25

### Added

- **`.pptx` support** — slide text extracted with a built-in minimal ZIP
  reader (no new dependency). Each slide is one chunk; slides are ordered
  numerically and image-only decks report a clear OCR-needed error.
- **`--style cloze`** — fill-in-the-blank cards via Anki's built-in Cloze
  notetype; cards without a `{{c1::...}}` marker are dropped, never exported
  as broken notes. Also offered in the wizard.
- **Response cache** (`~/.anki-forge/cache-v1.json`) — re-running the same
  material makes zero LLM calls; `--no-cache` bypasses. Keyed by content
  (model, style, language, chunk text).
- **`--export <file>`** — write cards to a TSV file (Anki: File → Import) so
  decks can be shared or imported on mobile without a running desktop Anki.

## [0.2.0] — 2026-09-25

### Added

- **Interactive wizard**: running `anki-forge` with no arguments in a terminal
  walks through files → deck → provider → model → key → preview, then offers
  the write. Non-TTY stdin still prints help and exits instead of hanging.
- **`--provider` shortcut** for known OpenAI-compatible endpoints (openai,
  deepseek, zhipu, kimi, siliconflow, ollama) — fills base URL and a model
  hint; explicit `--base-url`/`--model` still win.
- **Single-executable installs**: pushing a `v*` tag builds a self-contained
  binary per platform (Windows/Linux/macOS) and attaches it to a GitHub
  Release. No Node.js required on the user's machine.

## [0.1.0] — 2026-09-25

### Added

- `import` command: `.pdf` / `.md` / `.txt` → LLM → Anki deck, via AnkiConnect.
- `--dry-run` preview that writes nothing; `check` for connectivity.
- Any OpenAI-compatible endpoint via `--base-url` / `--model` / `--api-key`.
- Failure policy: per-chunk skip with reporting, one-shot JSON repair retry,
  duplicate and junk cards dropped before Anki sees them.
- Scanned PDFs (no text layer) rejected with a specific error, not an empty deck.
