/**
 * chunks → cards, via any OpenAI-compatible /chat/completions endpoint.
 * The fetcher is injectable for tests; production defaults to global fetch.
 *
 * Failure policy: one bad chunk is skipped and counted, never fatal — a
 * 400-page textbook must not lose its remaining 300 pages to one glitch.
 * Card-level junk (empty sides, duplicates, cloze cards with no cloze marker)
 * is dropped and counted rather than sent to Anki, where it would cost a review.
 *
 * Responses are cached by the SHA-256 of (model, style, language, chunk text),
 * so re-running a lecture with different filters or a re-import costs nothing.
 * The cache lives in the caller's hands — this module only consults what is
 * passed in.
 */
import { createHash } from 'node:crypto';

export const DEFAULTS = {
  baseUrl: 'https://api.openai.com/v1',
  model: null, // no default: the key's brand varies, guessing burns quota on the wrong model
  language: null, // null = follow the source material
  maxCardsPerChunk: 10,
  style: 'basic', // 'basic' (Q/A) or 'cloze' ({{c1::...}})
  concurrency: 4, // parallel chunks in flight; upstream rate limits cap this harder than we do
};

const BASIC_PROMPT = (language) => `You turn study material into Anki flashcards.
Rules for every card:
- One atomic fact or concept per card. If a card needs "and", split it.
- Front is a specific question or prompt; never "What is discussed in this section?".
- Back is a self-contained answer: understandable without seeing the source.
- Prefer cards that test recall of what the material emphasizes (definitions,
  contrasts, mechanisms, numbers, lists).
- No cards about navigation, figure references, or the document itself.
${language ? `- Write both front and back in ${language}.` : '- Write in the same language as the material.'}
Return ONLY a JSON array, no prose, no code fences:
[{"front": "...", "back": "...", "tags": ["..."]}]`;

const CLOZE_PROMPT = (language) => `You turn study material into Anki CLOZE flashcards.
Rules for every card:
- The front MUST contain at least one Anki cloze deletion like {{c1::answer}}.
- Keep the surrounding sentence intact so the deletion is answerable.
- One concept per card; number each deletion c1, c2 ... in order of appearance.
- back is a short extra note (hint or clarification); use "" when nothing helps.
- No cards about navigation, figure references, or the document itself.
${language ? `- Write in ${language}.` : '- Write in the same language as the material.'}
Return ONLY a JSON array, no prose, no code fences:
[{"front": "The mitochondria is the {{c1::powerhouse}} of the cell.", "back": "", "tags": ["..."]}]`;

/** Pull the first JSON array out of a model reply, tolerating code fences. */
export function extractJsonArray(text) {
  if (typeof text !== 'string') return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('[');
  const end = body.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(body.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const CLOZE_RE = /\{\{c1::[^}]+\}\}/;

function normalizeCard(raw, style) {
  if (!raw || typeof raw !== 'object') return null;
  const front = String(raw.front ?? '').trim();
  const back = String(raw.back ?? '').trim();
  if (!front || (style === 'basic' && !back)) return null;
  if (style === 'cloze' && !CLOZE_RE.test(front)) return null; // Cloze notetype renders this as broken
  if (front.length > 500 || back.length > 2000) return null; // model dumping a paragraph, not a card
  const tags = Array.isArray(raw.tags) ? raw.tags.map(String).filter(Boolean).slice(0, 5) : [];
  return { front, back, tags };
}

export function normalizeCards(rawCards, style = 'basic') {
  const cards = [];
  const seen = new Set();
  let dropped = 0;
  let duplicates = 0;
  for (const raw of rawCards) {
    const card = normalizeCard(raw, style);
    if (!card) {
      dropped++;
      continue;
    }
    const key = card.front.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    cards.push(card);
  }
  return { cards, dropped, duplicates };
}

async function chatOnce(baseUrl, apiKey, model, messages, fetchImpl) {
  const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, temperature: 0.3 }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`LLM API ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? '';
}

/** Cache key covers everything that changes the output for identical input. */
export function cacheKey(chunk, opts) {
  const h = createHash('sha256');
  h.update(JSON.stringify([opts.model, opts.style, opts.language, opts.maxCardsPerChunk, chunk.text]));
  return h.digest('hex').slice(0, 32);
}

/** Map with a concurrency limit, preserving input order in the output. */
async function pMapWithLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

/** Network-level failures deserve a proxy hint: most users behind national
 *  firewalls hit exactly this and see an opaque "fetch failed". */
function withNetHint(e) {
  const msg = String(e?.message ?? e);
  const code = String(e?.cause?.code ?? '');
  if (/fetch failed|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|CERT/i.test(msg + ' ' + code)) {
    return `${msg} — if your provider needs a proxy, set HTTPS_PROXY (e.g. http://127.0.0.1:7890) and retry`;
  }
  return msg;
}

/**
 * Generate cards for every chunk. Returns per-chunk stats so the caller can
 * show progress and the user can see exactly which section produced nothing.
 * `cache` (optional) maps cacheKey → raw card array. `onProgress(done, total)`
 * fires after each chunk settles, in completion order.
 */
export async function generateCards(chunks, opts, { fetchImpl = fetch, cache = null, onProgress = null } = {}) {
  // Explicit per-field fallbacks, not {...DEFAULTS, ...opts}: a flag that was
  // never passed arrives as null and would silently override the default
  // (style: null, baseUrl: null — both burned us in 0.3.0).
  const cfg = {
    baseUrl: opts.baseUrl ?? DEFAULTS.baseUrl,
    model: opts.model ?? DEFAULTS.model,
    language: opts.language ?? DEFAULTS.language,
    maxCardsPerChunk: opts.maxCardsPerChunk ?? DEFAULTS.maxCardsPerChunk,
    style: opts.style ?? DEFAULTS.style,
    concurrency: opts.concurrency ?? DEFAULTS.concurrency,
    apiKey: opts.apiKey,
  };
  if (!cfg.apiKey) throw new Error('no API key: pass --api-key or set OPENAI_API_KEY');
  if (!cfg.model) throw new Error('no model: pass --model (e.g. deepseek-chat, gpt-4o-mini, glm-4-flash)');
  if (!['basic', 'cloze'].includes(cfg.style)) throw new Error(`unknown card style "${cfg.style}" — use basic or cloze`);
  const systemPrompt = cfg.style === 'cloze' ? CLOZE_PROMPT(cfg.language) : BASIC_PROMPT(cfg.language);
  let done = 0;

  const perChunk = await pMapWithLimit(chunks, cfg.concurrency, async (chunk) => {
    const key = cacheKey(chunk, cfg);
    let rawCards = null;
    let lastError = null;
    let cached = false;
    if (cache) {
      const hit = cache.get(key);
      if (hit) {
        rawCards = hit;
        cached = true;
      }
    }
    if (rawCards === null) {
      const prompt =
        `Material section${chunk.title ? ` ("${chunk.title}")` : ''}:\n\n${chunk.text}`;
      for (let attempt = 0; attempt < 2 && rawCards === null; attempt++) {
        try {
          const reply = await chatOnce(cfg.baseUrl, cfg.apiKey, cfg.model, [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: attempt === 0 ? prompt : `${prompt}\n\nREMINDER: reply with ONLY the JSON array.` },
          ], fetchImpl);
          rawCards = extractJsonArray(reply);
          if (rawCards === null) lastError = new Error('model reply contained no JSON array');
        } catch (e) {
          lastError = e;
        }
      }
      if (rawCards !== null && cache) cache.set(key, rawCards);
    }
    done++;
    onProgress?.(done, chunks.length);
    if (rawCards === null) {
      return { title: chunk.title, generated: 0, error: withNetHint(lastError) ?? 'no JSON array' };
    }
    const limited = rawCards.slice(0, cfg.maxCardsPerChunk);
    const { cards, dropped, duplicates } = normalizeCards(limited, cfg.style);
    return { title: chunk.title, cards: cards.map((c) => ({ ...c, source: chunk.title || '' })), generated: cards.length, dropped, duplicates, cached };
  });

  return {
    cards: perChunk.flatMap((p) => p.cards ?? []),
    perChunk: perChunk.map(({ cards, ...rest }) => rest),
  };
}
