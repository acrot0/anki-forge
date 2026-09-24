# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.1.0] — 2026-09-25

### Added

- `import` command: `.pdf` / `.md` / `.txt` → LLM → Anki deck, via AnkiConnect.
- `--dry-run` preview that writes nothing; `check` for connectivity.
- Any OpenAI-compatible endpoint via `--base-url` / `--model` / `--api-key`.
- Failure policy: per-chunk skip with reporting, one-shot JSON repair retry,
  duplicate and junk cards dropped before Anki sees them.
- Scanned PDFs (no text layer) rejected with a specific error, not an empty deck.
