# anki-forge

[![CI](https://github.com/acrot0/anki-forge/actions/workflows/ci.yml/badge.svg)](https://github.com/acrot0/anki-forge/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%E2%89%A522.13-blue)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Turn textbooks, lecture notes and handouts into Anki decks — with **your own** LLM key.

```bash
npx anki-forge import lecture.pdf --deck "Med school::Cardio"
npx anki-forge import 考研政治讲义.md --deck "考研::政治" --dry-run   # preview, write nothing
```

```
  lecture.pdf: 42 chunks (pdf)
  generating cards with deepseek-chat (will write to Anki)...
  deck Med school::Cardio created
done: 311 added, 7 duplicates skipped (of 318 generated)
```

## Why this exists

AI flashcard generators are a paid feature everywhere (Quizlet Plus, Studyfetch,
AnkiPro…), and the open-source alternatives are weekend scripts. Meanwhile the
hard part — reliable file parsing, JSON repair, duplicate handling, Anki sync —
is exactly what a script gets wrong. anki-forge is the missing CLI:

- **Bring your own key.** Any OpenAI-compatible endpoint: OpenAI, DeepSeek, GLM,
  Kimi, Ollama, a gateway — `--base-url --model --api-key` and you're set.
- **`--dry-run` is free.** See the cards before a single token is written to Anki.
- **Nothing silently lost.** Every section that produced no cards is reported
  with the reason; duplicates are counted, never force-added.
- **One dependency.** `pdf-parse` is the only runtime dependency; everything
  else is Node built-ins.

## Install

**Windows** — download [`anki-forge-windows-x64.exe`](https://github.com/acrot0/anki-forge/releases/latest/download/anki-forge-windows-x64.exe) (or run `install.ps1` from the repo, which also tells you the one-line PATH step). SmartScreen may warn: the build is unsigned.

**Linux / macOS**:

```bash
curl -fL https://raw.githubusercontent.com/acrot0/anki-forge/main/install.sh | sh -
# or review it first: it just downloads the release binary into ~/.local/bin
```

The binaries are **self-contained** — no Node.js, no npm account, no npm install. (npm users: recent npm refuses `github:` and remote-tarball installs by default, which is why npm is not the recommended path here.)

## Quick start

**The graphical way** — run `anki-forge ui`: a local page where you drag files in,
pick a provider from a dropdown, watch per-chunk progress live, preview every card,
and download the .apkg or write straight into Anki with one click. Nothing leaves
your machine except the requests to your chosen LLM provider.

**The terminal way** — run the binary with no arguments for an interactive wizard, or:

```
$ anki-forge
anki-forge — study files → Anki deck. ENTER accepts the [suggestion].

  File(s) to import (comma-separated, .pdf/.md/.txt): 高数讲义.pdf
  Deck name ("::" nests) [Imported]: 考研::数学
  providers: openai, deepseek, zhipu, kimi, siliconflow, ollama
  Provider [deepseek]:
  Model [deepseek-chat]:
  API key (ENTER = $OPENAI_API_KEY):
  Preview cards first, write nothing yet (Y/n):
```

Prefer one-liners:

```bash
anki-forge import lecture.pdf --deck "Med school::Cardio"
anki-forge import 考研政治讲义.md --deck "考研::政治" --dry-run   # preview, write nothing
```

## Usage

```bash
anki-forge import <file...> --deck <name> [options]
anki-forge check        # is Anki reachable? is the key set?
```

| Option | Meaning |
|--------|---------|
| `--deck <name>` | target deck, `::` nests (`Med::Cardio`) — required |
| `--dry-run` | generate and preview, write nothing |
| `--max-cards-per-chunk N` | cap per section (default 10) |
| `--language LANG` | force card language; default follows the material |
| `--tags a,b` | extra tags on every card |
| `--base-url URL` / `--model NAME` / `--api-key KEY` | generation endpoint |
| `--anki-url URL` | default `http://127.0.0.1:8765` |

Files: `.pdf` (text layer), `.pptx` (text runs; one chunk per slide), `.md`,
`.txt`. Markdown headings become section boundaries; in plain text and PDF,
section titles are detected by shape.

## Beyond import

```bash
anki-forge import slides.pptx --deck "Course::Week1" --style cloze   # fill-in-the-blank cards
anki-forge import textbook.pdf --deck "Exam" --export deck.apkg      # shareable deck file, no Anki needed
anki-forge import textbook.pdf --deck "Exam" --concurrency 8         # faster on big decks
```

- **`.apkg` export** produces a real Anki deck file (schema 11, SQLite built
  in-process) — import it anywhere, send it to a classmate, keep it in git.
  The target deck travels inside the file.
- **Cloze cards** (`--style cloze`) use Anki's built-in Cloze notetype; the
  generator only emits cards with a real `{{c1::...}}` marker.
- **`--export` to TSV** (front ⇥ back ⇥ tags) for spreadsheets and diffs.
- **Parallel generation** (`--concurrency`, default 4) with a live progress
  bar; `--no-cache` re-runs, otherwise responses are cached under
  `~/.anki-forge/` (it contains card text extracted from your material).

## How it treats your material (and your money)

- Files are split into ~3000-char chunks, one LLM call each — cards stay
  anchored to the section they came from.
- The model must answer in strict JSON; malformed replies are retried once with
  a reminder, then the chunk is skipped and reported. One bad section never
  kills a 400-page book.
- Cards with an empty side, paragraph-length fronts, or duplicate fronts
  (case/whitespace-insensitive) are dropped before Anki sees them.
- `addNotes` runs with `allowDuplicate: false`; duplicates are reported, so the
  second import of the same chapter is a no-op, not a flood.

## 中文说明

把讲义、教材、笔记（PDF / Markdown / TXT）变成 Anki 卡组。用你自己的 API key
（OpenAI、DeepSeek、智谱、Kimi、Ollama 等任何 OpenAI 兼容端点）。

```bash
# 一次性准备：Anki 桌面版 + AnkiConnect 插件（代码 2055492159）
export OPENAI_API_KEY=你的key
export OPENAI_BASE_URL=https://api.deepseek.com/v1
export OPENAI_MODEL=deepseek-chat

npx anki-forge import 高数讲义.pdf --deck "考研::数学" --dry-run   # 先预览
npx anki-forge import 高数讲义.pdf --deck "考研::数学"             # 写入 Anki
```

扫描版 PDF（无文字层）会明确报错，不会生成空卡组；每张卡都有来源章节；重复卡
自动跳过。适合考研、医学生、语言学习者的成建制刷卡流程。

## Limitations

- Scanned PDFs are rejected with a clear error — run OCR first; anki-forge does
  not OCR.
- Cards are `Basic` (Front/Back) notes. Cloze and custom note types are not
  generated.
- Cost scales with material size: roughly one LLM call per ~3000 characters.
  `--dry-run` shows what you'd get before you spend anything beyond the preview.

## License

MIT
