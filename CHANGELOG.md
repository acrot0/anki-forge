# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
