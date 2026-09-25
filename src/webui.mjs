/**
 * Local web UI: `anki-forge ui` binds 127.0.0.1 on a random free port and
 * opens the browser. Same modules as the CLI (parse/generate/anki/apkg), so
 * there is exactly one generation path and the cache is shared.
 *
 * Security posture: loopback-only, request size cap, and the API key is used
 * for the single job request and then dropped — it is never written to disk
 * or echoed back.
 */
import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseBuffer } from './parse.mjs';
import { generateCards } from './generate.mjs';
import { generateLocal } from './local-engine.mjs';
import { loadCache } from './cache.mjs';
import { startStudy, getQueue, gradeCard } from './study.mjs';
import { writeApkgBytes } from './apkg.mjs';
import { checkConnection, addCards } from './anki.mjs';
import { PROVIDERS, applyProvider } from './providers.mjs';

// Directory of this module — only needed for the source-checkout readFile
// fallback. In the CJS bundle esbuild replaces import.meta.url with undefined,
// so probe lazily instead of computing it at load time.
let HERE = null;
function here() {
  if (HERE === null) {
    try {
      HERE = path.dirname(fileURLToPath(import.meta.url));
    } catch {
      HERE = '.';
    }
  }
  return HERE;
}
const MAX_BODY = 60 * 1024 * 1024; // 60 MB: a deck-sized PDF plus headroom

let HTML = null;
async function getHtml() {
  if (HTML) return HTML;
  try {
    // Bundled build (SEA): esbuild's text loader resolves .html to a string.
    HTML = (await import('./webui.html')).default;
  } catch {
    // Source checkout: node cannot import .html, read it from disk instead.
    HTML = await readFile(path.join(here(), 'webui.html'), 'utf8');
  }
  return HTML;
}

const jobs = new Map();
const JOBS_KEPT = 8;

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new Error('request too large');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(await getHtml());
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/providers') {
      return json(res, 200, PROVIDERS);
    }
    if (req.method === 'GET' && url.pathname === '/api/check') {
      try {
        const { version } = await checkConnection(process.env.ANKI_CONNECT_URL ?? 'http://127.0.0.1:8765');
        return json(res, 200, { ok: true, version });
      } catch (e) {
        return json(res, 200, { ok: false, error: e.message });
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/study/start') {
      const { jobId } = JSON.parse((await readBody(req)).toString('utf8'));
      const job = jobs.get(jobId);
      if (!job?.cards?.length) throw new Error('no cards to study — generate first');
      return json(res, 200, await startStudy(job.deck, job.cards));
    }
    if (req.method === 'GET' && url.pathname === '/api/study/queue') {
      const deck = url.searchParams.get('deck');
      if (!deck) throw new Error('deck is required');
      return json(res, 200, await getQueue(deck));
    }
    if (req.method === 'POST' && url.pathname === '/api/study/review') {
      const { deck, front, rating } = JSON.parse((await readBody(req)).toString('utf8'));
      if (!deck || !front) throw new Error('deck and front are required');
      return json(res, 200, await gradeCard(deck, front, Number(rating)));
    }
    if (req.method === 'POST' && url.pathname === '/api/generate') {
      const body = JSON.parse((await readBody(req)).toString('utf8'));
      const { name, dataBase64, deck, provider, model, apiKey, style, maxCards, language, concurrency, engine } = body;
      if (!name || !dataBase64) throw new Error('name and dataBase64 are required');
      if (!deck) throw new Error('deck is required');
      const useLocal = engine === 'local';
      const args = applyProvider({
        apiKey, model, style, language,
        provider: provider || null,
        baseUrl: null,
        maxCardsPerChunk: Number(maxCards) || 10,
        concurrency: Math.min(Math.max(Number(concurrency) || 4, 1), 12),
      });
      if (!useLocal && !args.apiKey) throw new Error('no API key — switch to the local engine (free, offline) or provide one');
      const buf = Buffer.from(dataBase64, 'base64');
      const { chunks, kind } = await parseBuffer(path.extname(name), buf, { name });
      const id = Math.random().toString(36).slice(2);
      const job = {
        status: 'running', kind, total: chunks.length, done: 0,
        cards: [], perChunk: [], deck, error: null, apiKey, style: args.style,
        engine: useLocal ? 'local' : 'llm',
        started: Date.now(),
      };
      jobs.set(id, job);
      while (jobs.size > JOBS_KEPT) {
        const oldest = [...jobs.entries()].sort((a, b) => a[1].started - b[1].started)[0][0];
        jobs.delete(oldest);
      }
      // Run in the background; the client polls /api/job/:id. The API key is
      // used here and never stored beyond this closure.
      (async () => {
        try {
          const opts = {
            apiKey: job.apiKey, model: args.model, style: args.style,
            language: args.language ?? null, baseUrl: args.baseUrl,
            maxCardsPerChunk: args.maxCardsPerChunk, concurrency: args.concurrency,
          };
          const cache = useLocal ? null : await loadCache();
          const result = useLocal
            ? await generateLocal(chunks, opts, { onProgress: (done, total) => { job.done = done; } })
            : await generateCards(chunks, opts, {
                cache,
                onProgress: (done, total) => { job.done = done; },
              });
          if (cache) await cache.save();
          job.cards = result.cards;
          job.perChunk = result.perChunk;
          job.status = 'done';
        } catch (e) {
          job.error = e.message;
          job.status = 'error';
        } finally {
          delete job.apiKey; // used once, then gone
        }
      })();
      return json(res, 200, { id, kind, total: chunks.length, engine: useLocal ? 'local' : 'llm' });
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/job/')) {
      const id = url.pathname.split('/').pop();
      const job = jobs.get(id);
      if (!job) return json(res, 404, { error: 'no such job' });
      const { apiKey, ...safe } = job;
      return json(res, 200, safe);
    }
    if (req.method === 'POST' && url.pathname === '/api/export') {
      const { jobId, format } = JSON.parse((await readBody(req)).toString('utf8'));
      const job = jobs.get(jobId);
      if (!job?.cards?.length) throw new Error('no cards to export — generate first');
      const safeName = (job.deck || 'anki-forge').replace(/[^\w\u4e00-\u9fa5-]+/g, '_');
      if (format === 'apkg') {
        const bytes = await writeApkgBytes(job.cards, { deckName: job.deck, style: job.style });
        res.writeHead(200, {
          'content-type': 'application/octet-stream',
          'content-disposition': `attachment; filename="${encodeURIComponent(safeName)}.apkg"`,
        });
        res.end(bytes);
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(job.cards.map((c) => [c.front, c.back, (c.tags ?? []).join(' ')].join('\t')).join('\n'));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/anki') {
      const { jobId, deck } = JSON.parse((await readBody(req)).toString('utf8'));
      const job = jobs.get(jobId);
      if (!job?.cards?.length) throw new Error('no cards to add — generate first');
      const result = await addCards(job.cards, {
        url: process.env.ANKI_CONNECT_URL ?? 'http://127.0.0.1:8765',
        deck: deck || job.deck,
      });
      return json(res, 200, result);
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    json(res, 400, { error: e.message });
  }
}

/** Start the UI server. Resolves with the URL once listening. */
export function startUi({ port = 0, open = true } = {}) {
  const server = http.createServer((req, res) => handle(req, res).catch(() => json(res, 500, { error: 'internal error' })));
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', async () => {
      const { port: actual } = server.address();
      const url = `http://127.0.0.1:${actual}`;
      if (open) {
        const { spawn } = await import('node:child_process');
        const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
        const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
        spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
      }
      resolve({ url, server, close: () => server.close() });
    });
  });
}
