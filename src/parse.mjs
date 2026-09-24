/**
 * File → chunks. A chunk is the unit sent to the LLM: big enough to have
 * context, small enough that one response stays coherent.
 *
 * Splitting rules, in priority order:
 *   .md  → markdown headings (# .. ###), then by size
 *   .txt → paragraph runs accumulated up to maxChars
 *   .pdf → extracted text; heading-like short lines split, size splits as fallback
 *
 * A PDF with no text layer (scan) is a hard error — silently producing an
 * empty deck from an OCR-needing file would look like a success and waste
 * the user's API budget.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_MAX_CHARS = 3000;
export const MIN_CHARS = 200;

const HEADING_RE = /^(#{1,3})\s+(.+)/;

/**
 * Heading-like for PDFs: no text-layer formatting to lean on, so judge by
 * shape. Accepts "Chapter 3 Thermodynamics" and "3.1 Kinetic theory"; rejects
 * list items, bare numbers, clause punctuation, and sentence endings.
 */
function pdfTitle(line) {
  const t = line.trim();
  if (t.length < 2 || t.length > 80) return null;
  if (/^([-•*]|\d+\.)\s/.test(t)) return null; // list item
  if (/[.。!！?？]$/.test(t)) return null; // ends like a sentence
  if (/[,，;；]/.test(t)) return null; // clause punctuation
  if (/^\d+$/.test(t)) return null; // bare number
  return t;
}

/** Accumulate lines into chunks of at most maxChars, merging undersized runs. */
function packLines(lines, maxChars, titleOf) {
  const chunks = [];
  let cur = { title: titleOf(''), parts: [] };
  const flush = () => {
    const text = cur.parts.join('\n').trim();
    if (text) chunks.push({ title: cur.title, text });
    cur = { title: titleOf(''), parts: [] };
  };
  for (const line of lines) {
    const t = titleOf(line);
    if (t) {
      // The heading line itself lives in `title`, never in `text` — a chunk
      // that re-contains its own heading would double-feed it to the LLM.
      if (cur.parts.join('\n').length > MIN_CHARS) flush();
      cur.title = t;
      continue;
    }
    if (cur.parts.join('\n').length + line.length + 1 > maxChars) flush();
    cur.parts.push(line);
  }
  flush();
  return chunks;
}

export function parseMarkdown(text, { maxChars = DEFAULT_MAX_CHARS } = {}) {
  return packLines(text.split(/\r?\n/), maxChars, (line) => {
    const m = line.match(HEADING_RE);
    return m ? m[2].trim() : null;
  });
}

export function parseText(text, { maxChars = DEFAULT_MAX_CHARS } = {}) {
  return packLines(text.split(/\r?\n/), maxChars, () => null);
}

export function parsePdfText(text, { maxChars = DEFAULT_MAX_CHARS } = {}) {
  return packLines(text.split(/\r?\n/), maxChars, pdfTitle);
}

/**
 * Read a file and split it into chunks. Only the extension is trusted for
 * routing: a scanned .pdf reports a specific error instead of an empty deck.
 */
export async function parseFile(filePath, opts = {}) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.pdf' && ext !== '.md' && ext !== '.markdown' && ext !== '.txt' && ext !== '') {
    throw new Error(`unsupported file type "${ext}" (${filePath}) — use .pdf, .md or .txt`);
  }
  if (ext === '.pdf') {
    const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
    const buf = await readFile(filePath);
    let data;
    try {
      data = await pdfParse(buf);
    } catch (e) {
      throw new Error(`could not parse PDF ${filePath}: ${e.message}`);
    }
    const text = (data.text || '').trim();
    if (text.length < MIN_CHARS) {
      throw new Error(
        `${filePath}: PDF has no usable text layer (${text.length} chars extracted) — ` +
          'it is most likely a scan. OCR it first; anki-forge does not OCR.',
      );
    }
    return { chunks: parsePdfText(text, opts), kind: 'pdf' };
  }
  const raw = await readFile(filePath, 'utf8');
  if (ext === '.md' || ext === '.markdown') return { chunks: parseMarkdown(raw, opts), kind: 'markdown' };
  return { chunks: parseText(raw, opts), kind: 'text' };
}
