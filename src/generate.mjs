/**
 * chunks → cards, via any OpenAI-compatible /chat/completions endpoint.
 * The fetcher is injectable for tests; production defaults to global fetch.
 *
 * Failure policy: one bad chunk is skipped and counted, never fatal — a
 * 400-page textbook must not lose its remaining 300 pages to one glitch.
 * Card-level junk (empty sides, duplicates) is dropped and counted rather
 * than sent to Anki, where a duplicate still costs a review.
 */
export const DEFAULTS = {
  baseUrl: 'https://api.openai.com/v1',
  model: null, // no default: the key's brand varies, guessing burns quota on the wrong model
  language: null, // null = follow the source material
  maxCardsPerChunk: 10,
};

const SYSTEM_PROMPT = (language) => `You turn study material into Anki flashcards.
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

function normalizeCard(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const front = String(raw.front ?? '').trim();
  const back = String(raw.back ?? '').trim();
  if (!front || !back) return null;
  if (front.length > 500 || back.length > 2000) return null; // model dumping a paragraph, not a card
  const tags = Array.isArray(raw.tags) ? raw.tags.map(String).filter(Boolean).slice(0, 5) : [];
  return { front, back, tags };
}

export function normalizeCards(rawCards) {
  const cards = [];
  const seen = new Set();
  let dropped = 0;
  let duplicates = 0;
  for (const raw of rawCards) {
    const card = normalizeCard(raw);
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

/**
 * Generate cards for every chunk. Returns per-chunk stats so the caller can
 * show progress and the user can see exactly which section produced nothing.
 */
export async function generateCards(chunks, opts, { fetchImpl = fetch } = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  if (!cfg.apiKey) throw new Error('no API key: pass --api-key or set OPENAI_API_KEY');
  if (!cfg.model) throw new Error('no model: pass --model (e.g. deepseek-chat, gpt-4o-mini, glm-4-flash)');
  const out = [];
  const perChunk = [];
  for (const chunk of chunks) {
    const prompt =
      `Material section${chunk.title ? ` ("${chunk.title}")` : ''}:\n\n${chunk.text}`;
    let rawCards = null;
    let lastError = null;
    for (let attempt = 0; attempt < 2 && rawCards === null; attempt++) {
      try {
        const reply = await chatOnce(cfg.baseUrl, cfg.apiKey, cfg.model, [
          { role: 'system', content: SYSTEM_PROMPT(cfg.language) },
          { role: 'user', content: attempt === 0 ? prompt : `${prompt}\n\nREMINDER: reply with ONLY the JSON array.` },
        ], fetchImpl);
        rawCards = extractJsonArray(reply);
        if (rawCards === null) lastError = new Error('model reply contained no JSON array');
      } catch (e) {
        lastError = e;
      }
    }
    if (rawCards === null) {
      perChunk.push({ title: chunk.title, generated: 0, error: lastError?.message ?? 'no JSON array' });
      continue;
    }
    const limited = rawCards.slice(0, cfg.maxCardsPerChunk);
    const { cards, dropped, duplicates } = normalizeCards(limited);
    out.push(...cards.map((c) => ({ ...c, source: chunk.title || '' })));
    perChunk.push({ title: chunk.title, generated: cards.length, dropped, duplicates });
  }
  return { cards: out, perChunk };
}
