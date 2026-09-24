import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { extractJsonArray, normalizeCards, generateCards } from '../src/generate.mjs';

describe('extractJsonArray', () => {
  test('parses a bare array', () => {
    assert.deepEqual(extractJsonArray('[{"front":"a","back":"b"}]'), [{ front: 'a', back: 'b' }]);
  });

  test('parses inside a code fence', () => {
    assert.deepEqual(extractJsonArray('Here you go:\n```json\n[{"front":"a","back":"b"}]\n```'), [{ front: 'a', back: 'b' }]);
  });

  test('parses with prose around it', () => {
    assert.deepEqual(extractJsonArray('Sure! [{"front":"a","back":"b"}] — done.'), [{ front: 'a', back: 'b' }]);
  });

  test('returns null for no array, broken JSON, or non-array JSON', () => {
    assert.equal(extractJsonArray('no json here'), null);
    assert.equal(extractJsonArray('[{broken'), null);
    assert.equal(extractJsonArray('{"front":"a"}'), null);
    assert.equal(extractJsonArray(null), null);
  });
});

describe('normalizeCards', () => {
  test('drops empty sides and oversized junk, counts them', () => {
    const { cards, dropped } = normalizeCards([
      { front: 'ok', back: 'fine' },
      { front: '', back: 'no front' },
      { front: 'x'.repeat(501), back: 'too long' },
    ]);
    assert.equal(cards.length, 1);
    assert.equal(dropped, 2);
  });

  test('deduplicates case-insensitively on whitespace-collapsed front', () => {
    const { cards, duplicates } = normalizeCards([
      { front: 'What  is ATP?', back: 'energy' },
      { front: 'what is atp?', back: 'energy again' },
    ]);
    assert.equal(cards.length, 1);
    assert.equal(duplicates, 1);
  });
});

describe('generateCards', () => {
  const chunks = [{ title: 'S1', text: 'fact one' }, { title: 'S2', text: 'fact two' }];
  const opts = { apiKey: 'k', model: 'm' };

  test('generates cards from a working endpoint', async () => {
    const fetchImpl = async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '[{"front":"q","back":"a","tags":["t"]}]' } }] }),
    });
    const { cards, perChunk } = await generateCards(chunks, opts, { fetchImpl });
    assert.equal(cards.length, 2);
    assert.equal(cards[0].source, 'S1');
    assert.ok(perChunk.every((c) => c.generated === 1 && !c.error));
  });

  test('retries a garbage reply and recovers', async () => {
    let call = 0;
    const fetchImpl = async () => {
      call++;
      const content = call % 2 === 1 ? 'I cannot do that.' : '[{"front":"q","back":"a"}]';
      return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
    };
    const { perChunk } = await generateCards([chunks[0]], opts, { fetchImpl });
    assert.equal(call, 2);
    assert.equal(perChunk[0].generated, 1);
  });

  test('skips a chunk after retry instead of failing the whole run', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'nope' } }] }) });
    const { cards, perChunk } = await generateCards(chunks, opts, { fetchImpl });
    assert.equal(cards.length, 0);
    assert.ok(perChunk.every((c) => c.error));
  });

  test('a failing HTTP call skips the chunk with the status in the error', async () => {
    const fetchImpl = async () => ({ ok: false, status: 429, text: async () => 'rate limited' });
    const { perChunk } = await generateCards([chunks[0]], opts, { fetchImpl });
    assert.match(perChunk[0].error, /429/);
  });

  test('caps cards per chunk', async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ front: `q${i}`, back: `a${i}` }));
    const fetchImpl = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(many) } }] }) });
    const { cards } = await generateCards([chunks[0]], { ...opts, maxCardsPerChunk: 5 }, { fetchImpl });
    assert.equal(cards.length, 5);
  });

  test('requires key and model up front', async () => {
    await assert.rejects(generateCards(chunks, { model: 'm' }), /API key/);
    await assert.rejects(generateCards(chunks, { apiKey: 'k' }), /model/);
  });
});
