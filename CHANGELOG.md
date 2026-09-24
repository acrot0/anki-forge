# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
