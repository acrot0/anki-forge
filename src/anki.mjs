/**
 * Minimal AnkiConnect client (http://127.0.0.1:8765, the Anki desktop add-on).
 * Read-mostly: the only writes are deck creation and note adds. Duplicates are
 * reported per note (addNotes returns null for them) — never force-added.
 */
const VERSION = 6;

export async function ankiConnect(url, action, params = {}, { fetchImpl = fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, version: VERSION, params }),
    });
  } catch (e) {
    throw new Error(
      `cannot reach AnkiConnect at ${url} (${e.message}) — open Anki with the AnkiConnect add-on installed`,
    );
  }
  const data = await res.json().catch(() => null);
  if (!data) throw new Error(`AnkiConnect returned a non-JSON response from ${url}`);
  if (data.error) throw new Error(`AnkiConnect ${action} failed: ${data.error}`);
  return data.result;
}

export async function checkConnection(url, opts = {}) {
  const version = await ankiConnect(url, 'version', {}, opts);
  return { ok: true, version };
}

export async function ensureDeck(deck, opts = {}) {
  const names = await ankiConnect(opts.url, 'deckNames', {}, opts);
  if (names.includes(deck)) return { created: false };
  await ankiConnect(opts.url, 'createDeck', { deck }, opts);
  return { created: true };
}

/**
 * Add cards as Basic notes. `null` results in addNotes' reply mean "duplicate"
 * — surfaced separately so users learn what they already have instead of
 * wondering why the deck is smaller than the log promised.
 */
export async function addCards(cards, { url, deck, tags = [] }, { fetchImpl = fetch } = {}) {
  if (cards.length === 0) return { added: 0, duplicates: 0, errors: [] };
  const notes = cards.map((c) => ({
    deckName: deck,
    modelName: 'Basic',
    fields: { Front: c.front, Back: c.back },
    tags: [...new Set([...tags, ...(c.tags ?? [])])],
    options: { allowDuplicate: false },
  }));
  const results = await ankiConnect(url, 'addNotes', { notes }, { fetchImpl });
  let added = 0;
  let duplicates = 0;
  const errors = [];
  results.forEach((r, i) => {
    if (typeof r === 'number') added++;
    else if (r === null) duplicates++;
    else errors.push({ index: i, error: String(r) });
  });
  return { added, duplicates, errors };
}
