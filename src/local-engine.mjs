/**
 * Local rule-based card engine — no API key, no network, no cost.
 *
 * Deterministic pattern extraction from study text: definitional sentences,
 * enumerations, cause-effect pairs, and number/era facts. Honest about its
 * ceiling: it is mechanical and only shines on well-structured material
 * (textbooks with "X 是 Y" sentences); the LLM engine is strictly smarter.
 * Same output shape as generateCards, so the rest of the pipeline
 * (normalization, dedup, Anki/apkg export) is shared.
 */

const MIN_FRONT = 4;
const MAX_FRONT = 80;
const MIN_BACK = 3;
const MAX_BACK = 220;

/** Each rule: [pattern, front/back builders]. First match wins per sentence.
 *  Chinese and English patterns coexist in one list — a sentence matches the
 *  language it is written in, so language=null still produces the right
 *  question language. The `language` option only forces one set. */
function rules(language) {
  const forceEn = language === 'en';
  const forceZh = language === 'zh';
  const zhRules = [
    {
      re: /^(.{2,40}?)(?:是指|指的是|就是|是|称为|叫做)(.{4,160})[。．；;]?$/,
      make: (m) => ({ front: `什么是${m[1].trim()}？`, back: m[2].trim() }),
    },
    {
      re: /^(.{2,30}?)(?:包括|分为|包含|有以下|可分成)(.{4,180})[。；;]?$/,
      make: (m) => ({ front: `${m[1].trim()}包括哪些内容？`, back: m[2].trim() }),
    },
    {
      re: /^(.{3,50}?)(?:导致|引起|造成|使得|促使)(.{4,140})[。．；;]?$/,
      make: (m) => {
        // The lazy capture swallows modal endings ("过度疲劳会" + "导致"); strip
        // them so the question reads 过度疲劳, not 过度疲劳会.
        const subject = m[1].trim().replace(/(?:会|将|可能|能)$/, '') || m[1].trim();
        return { front: `${subject}会导致什么？`, back: m[2].trim() };
      },
    },
  ];
  const enRules = [
    {
      re: /^(.{2,60}?)\s+(?:is|are|refers to|means|is defined as)\s+(.{4,200})[.;]?$/i,
      make: (m) => ({ front: `What is ${m[1].trim()}?`, back: m[2].trim() }),
    },
    {
      re: /^(.{2,40}?)\s+(?:includes|consists of|comprises|is divided into)\s+(.{4,200})[.;]?$/i,
      make: (m) => ({ front: `What does ${m[1].trim()} include?`, back: m[2].trim() }),
    },
    {
      re: /^(.{3,60}?)\s+(?:causes|leads to|results in)\s+(.{4,180})[.;]?$/i,
      make: (m) => ({ front: `What does ${m[1].trim()} lead to?`, back: m[2].trim() }),
    },
  ];
  const numeric = {
    // 年份/数值事实（中文问法为默认；英文材料罕见此模式，接受混排）
    re: /^(.{2,36}?)(?:是|为|达到|约|大约|共)(\s*(?:公元)?\d[\d,.]*\s*(?:年|个|%|％|倍|千米|公里|米|克|千克|万吨|亿))[^。；]{0,60}[。；;]?$/,
    make: (m) => ({ front: `${m[1].trim()}是多少？`, back: m[2].trim() }),
  };
  if (forceEn) return [...enRules, numeric];
  if (forceZh) return [...zhRules, numeric];
  return [...zhRules, ...enRules, numeric];
}

function sentences(text) {
  return text
    .split(/(?<=[。！？!?；;\n])/)
    .map((s) => s.replace(/^[\s•·\-*\d]+[.、)\]]*\s*/, '').trim())
    .filter((s) => s.length >= MIN_FRONT + MIN_BACK);
}

/**
 * Extract cards from one chunk of text. Returns {front, back, tags} —
 * the same shape the LLM engine emits.
 */
export function extractCards(text, { language = null, maxCards = 10 } = {}) {
  const out = [];
  const seen = new Set();
  const rs = rules(language);
  for (const s of sentences(text)) {
    if (out.length >= maxCards) break;
    for (const rule of rs) {
      const m = s.match(rule.re);
      if (!m) continue;
      let card;
      try {
        card = rule.make(m);
      } catch {
        continue;
      }
      if (!card.front || !card.back) continue;
      if (card.front.length < MIN_FRONT || card.front.length > MAX_FRONT) continue;
      if (card.back.length < MIN_BACK || card.back.length > MAX_BACK) continue;
      const key = card.front.toLowerCase().replace(/\s+/g, ' ');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...card, tags: [] });
      break;
    }
  }
  return out;
}

/**
 * Local engine: same contract as generateCards (chunks in, cards + perChunk
 * out) so the CLI/Web UI switch engines without touching the pipeline.
 */
export async function generateLocal(chunks, opts = {}, { onProgress = null } = {}) {
  const maxCards = opts.maxCardsPerChunk ?? 10;
  const language = opts.language ?? null;
  const out = [];
  const perChunk = [];
  let done = 0;
  for (const chunk of chunks) {
    const cards = extractCards(chunk.text, { language, maxCards }).map((c) => ({
      ...c,
      source: chunk.title || '',
    }));
    out.push(...cards);
    done++;
    onProgress?.(done, chunks.length);
    perChunk.push({ title: chunk.title, generated: cards.length, dropped: 0, duplicates: 0, cached: false });
  }
  return { cards: out, perChunk };
}
