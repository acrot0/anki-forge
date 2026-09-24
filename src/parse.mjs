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
import { readZip } from './zip.mjs';

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
  // Check before reading: an unsupported extension should not surface as a
  // misleading ENOENT when the file also doesn't exist.
  if (!['.pdf', '.md', '.markdown', '.txt', '.pptx', '.docx', '.xlsx', ''].includes(ext)) {
    throw new Error(`unsupported file type "${ext}" (${filePath}) — use .pdf, .pptx, .docx, .xlsx, .md or .txt`);
  }
  const buf = await readFile(filePath);
  return parseBuffer(ext, buf, { name: path.basename(filePath), ...opts });
}

/**
 * Parse an in-memory file (web UI uploads). Ext-based dispatch is shared with
 * parseFile so both paths stay honest about the same supported set.
 */
export async function parseBuffer(ext, buf, opts = {}) {
  const name = opts.name ?? 'upload';
  ext = ext.toLowerCase();
  const supported = ['.pdf', '.md', '.markdown', '.txt', '.pptx', '.docx', '.xlsx', ''];
  if (!supported.includes(ext)) {
    throw new Error(`unsupported file type "${ext}" (${name}) — use .pdf, .pptx, .docx, .xlsx, .md or .txt`);
  }
  if (ext === '.pdf') {
    const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
    let data;
    try {
      data = await pdfParse(buf);
    } catch (e) {
      throw new Error(`could not parse PDF ${name}: ${e.message}`);
    }
    const text = (data.text || '').trim();
    if (text.length < MIN_CHARS) {
      throw new Error(
        `${name}: PDF has no usable text layer (${text.length} chars extracted) — ` +
          'it is most likely a scan. OCR it first; anki-forge does not OCR.',
      );
    }
    return { chunks: parsePdfText(text, opts), kind: 'pdf' };
  }
  if (ext === '.pptx') return { chunks: parsePptx(buf, opts), kind: 'pptx' };
  if (ext === '.docx') return { chunks: parseDocx(buf, opts), kind: 'docx' };
  if (ext === '.xlsx') return { chunks: parseXlsx(buf, opts), kind: 'xlsx' };
  const raw = buf.toString('utf8');
  if (ext === '.md' || ext === '.markdown') return { chunks: parseMarkdown(raw, opts), kind: 'markdown' };
  return { chunks: parseText(raw, opts), kind: 'text' };
}

/** Slide N ordering is numeric, not lexical — slide10 comes after slide9. */
export function parsePptx(buf, opts = {}) {
  const entries = readZip(buf);
  const slideNames = [...entries.keys()]
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/(\d+)/)[1]) - Number(b.match(/(\d+)/)[1]));
  if (slideNames.length === 0) {
    throw new Error('no slides found — is this really a .pptx file?');
  }
  // Each slide is a chunk: a page is the natural section of a deck, and the
  // generic size-based merge below would blend adjacent slides and overwrite
  // their titles (slides are usually shorter than MIN_CHARS).
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const chunks = [];
  let extracted = 0;
  for (const [i, name] of slideNames.entries()) {
    const xml = entries.get(name).toString('utf8');
    const texts = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXml(m[1].trim())).filter(Boolean);
    if (texts.length === 0) continue;
    extracted += texts.join('').length;
    const hasTitle = texts[0].length <= 60;
    const title = hasTitle ? texts[0] : `Slide ${i + 1}`;
    const body = (hasTitle ? texts.slice(1) : texts).join('\n').trim();
    const parts = body.length > maxChars
      ? packLines(body.split(/\r?\n/), maxChars, pdfTitle)
      : [{ title: body ? title : null, text: body }];
    for (const p of parts) {
      if (p.text) chunks.push({ title: hasTitle ? title : p.title, text: p.text });
    }
  }
  if (extracted < 40) {
    throw new Error(
      `PPTX has almost no extractable text (${extracted} chars) — image-only slides need OCR; anki-forge does not OCR.`,
    );
  }
  return chunks;
}

/**
 * Spreadsheets (vocab lists, glossaries): one sheet row becomes one line,
 * cells joined with " | " so term/definition pairs survive as a unit. Shared
 * strings come from xl/sharedStrings.xml; inline strings and plain numbers
 * are read straight from the cell.
 */
export function parseXlsx(buf, opts = {}) {
  const entries = readZip(buf);
  const shared = [];
  const sst = entries.get('xl/sharedStrings.xml');
  if (sst) {
    for (const si of sst.toString('utf8').matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      shared.push([...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeXml(t[1])).join(''));
    }
  }
  const sheets = [...entries.keys()].filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort();
  if (sheets.length === 0) throw new Error('no worksheets found — is this really a .xlsx file?');
  const lines = [];
  for (const [i, name] of sheets.entries()) {
    const xml = entries.get(name).toString('utf8');
    const rows = [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)];
    if (sheets.length > 1 && rows.length > 0) lines.push(`Sheet ${i + 1}`);
    for (const row of rows) {
      const cells = [...row[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)].map((c) => {
        // Attribute extraction must come from the captured attr string: a
        // single regex with an optional t="..." group lets the greedy part
        // swallow the attribute and every cell degrades to a string index.
        const type = (c[1].match(/\bt="(\w+)"/) || [])[1];
        const body = c[2];
        if (type === 's') {
          const v = body.match(/<v>([^<]*)<\/v>/);
          return v ? decodeXml(shared[Number(v[1])] ?? '') : '';
        }
        const inline = body.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/);
        if (inline) return decodeXml(inline[1]);
        const v = body.match(/<v>([^<]*)<\/v>/);
        return v ? decodeXml(v[1]) : '';
      }).filter((x) => x !== '');
      if (cells.length > 0) lines.push(cells.join(' | '));
    }
  }
  const text = lines.join('\n').trim();
  if (text.length < 40) {
    throw new Error('XLSX has almost no extractable text — empty workbook?');
  }
  return parseText(text, opts);
}

function decodeXml(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Word documents: <w:p> paragraphs, <w:t> text runs. Paragraphs become lines,
 * then the generic size-based packing applies (prose is long enough that the
 * merge logic works here, unlike slides).
 */
export function parseDocx(buf, opts = {}) {
  const entries = readZip(buf);
  const xml = entries.get('word/document.xml');
  if (!xml) throw new Error('not a .docx (no word/document.xml inside)');
  const paragraphs = [...xml.toString('utf8').matchAll(/<w:p[ >]([\s\S]*?)<\/w:p>/g)]
    // Collapse XML pretty-printing whitespace inside runs but keep real
    // spaces: Word splits runs at spell-check boundaries, where the trailing
    // space of one run is the separator between words of the next.
    .map((m) => [...m[1].matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((t) => decodeXml(t[1].replace(/\s+/g, ' '))).join(''))
    .map((p) => p.trim())
    .filter(Boolean);
  if (paragraphs.join('').length < 40) {
    throw new Error('DOCX has almost no extractable text — scanned images need OCR; anki-forge does not OCR.');
  }
  return parseText(paragraphs.join('\n'), opts);
}
