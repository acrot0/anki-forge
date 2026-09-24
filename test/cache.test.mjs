import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadCache } from '../src/cache.mjs';
import { generateCards, normalizeCards } from '../src/generate.mjs';

describe('loadCache', () => {
  test('persists entries across reloads', async () => {
    const file = path.join(await mkdtemp(path.join(tmpdir(), 'af-cache-')), 'cache.json');
    const a = await loadCache(file);
    a.set('k1', [{ front: 'q', back: 'a' }]);
    await a.save();
    const b = await loadCache(file);
    assert.deepEqual(b.get('k1'), [{ front: 'q', back: 'a' }]);
    const raw = JSON.parse(await readFile(file, 'utf8'));
    assert.deepEqual(raw.k1, [{ front: 'q', back: 'a' }]);
  });

  test('a missing file is a cold cache, not an error', async () => {
    const c = await loadCache(path.join(await mkdtemp(path.join(tmpdir(), 'af-cache-')), 'nope.json'));
    assert.equal(c.get('anything'), undefined);
  });
});

describe('generateCards + cache', () => {
  const chunk = [{ title: 'S', text: 'same material every time' }];
  const opts = { apiKey: 'k', model: 'm' };
  const ok = (content) => async () => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) });

  test('second run with a shared cache makes zero LLM calls', async () => {
    const memory = new Map();
    const cache = { get: (k) => memory.get(k), set: (k, v) => memory.set(k, v) };
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return ok('[{"front":"q","back":"a"}]')();
    };
    const r1 = await generateCards(chunk, opts, { fetchImpl, cache });
    assert.equal(calls, 1);
    const r2 = await generateCards(chunk, opts, { fetchImpl, cache });
    assert.equal(calls, 1, 'second run must be served from cache');
    assert.deepEqual(r2.cards, r1.cards);
    assert.equal(r2.perChunk[0].cached, true);
  });

  test('changing the model busts the cache', async () => {
    const memory = new Map();
    const cache = { get: (k) => memory.get(k), set: (k, v) => memory.set(k, v) };
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return ok('[{"front":"q","back":"a"}]')();
    };
    await generateCards(chunk, opts, { fetchImpl, cache });
    await generateCards(chunk, { ...opts, model: 'other' }, { fetchImpl, cache });
    assert.equal(calls, 2);
  });
});

describe('cloze style', () => {
  test('cards without a cloze marker are dropped', () => {
    const { cards, dropped } = normalizeCards(
      [
        { front: 'The capital of France is {{c1::Paris}}.', back: '' },
        { front: 'no marker here', back: '' },
      ],
      'cloze',
    );
    assert.equal(cards.length, 1);
    assert.equal(dropped, 1);
  });

  test('cloze generation uses the cloze system prompt and keeps markers', async () => {
    let system = '';
    const fetchImpl = async (_url, init) => {
      system = JSON.parse(init.body).messages[0].content;
      return ok('[{"front":"DNA is {{c1::deoxyribonucleic}} acid.","back":""}]')();
    };
    const { cards } = await generateCards([{ title: 'S', text: 'material' }], { apiKey: 'k', model: 'm', style: 'cloze' }, { fetchImpl });
    assert.match(system, /CLOZE/);
    assert.match(cards[0].front, /\{\{c1::deoxyribonucleic\}\}/);
  });
});

function ok(content) {
  return async () => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) });
}
