import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { checkConnection, ensureDeck, addCards } from '../src/anki.mjs';

let server;
let url;
const seen = [];

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const { action, params } = JSON.parse(body);
      seen.push({ action, params });
      const reply = (result) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ result, error: null }));
      };
      if (action === 'version') reply(6);
      else if (action === 'deckNames') reply(['Existing']);
      else if (action === 'createDeck') reply(null);
      else if (action === 'addNotes') reply(params.notes.map((_, i) => (i === 1 ? null : 1700000000000 + i)));
      else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ result: null, error: `unknown action ${action}` }));
      }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

// getter, not a plain copy: `url` is assigned inside before(), and a plain
// `{ url }` here would capture the undefined module-load-time value forever.
const opts = {
  get url() {
    return url;
  },
};

describe('AnkiConnect client', () => {
  test('checkConnection returns the protocol version', async () => {
    const { ok, version } = await checkConnection(url, opts);
    assert.equal(ok, true);
    assert.equal(version, 6);
  });

  test('ensureDeck reuses an existing deck without creating', async () => {
    seen.length = 0;
    const { created } = await ensureDeck('Existing', opts);
    assert.equal(created, false);
    assert.ok(!seen.some((s) => s.action === 'createDeck'));
  });

  test('ensureDeck creates a missing deck', async () => {
    seen.length = 0;
    const { created } = await ensureDeck('New::Deck', opts);
    assert.equal(created, true);
    assert.ok(seen.some((s) => s.action === 'createDeck' && s.params.deck === 'New::Deck'));
  });

  test('addCards counts duplicates separately from adds', async () => {
    const cards = [
      { front: 'q1', back: 'a1', tags: ['x'] },
      { front: 'q2', back: 'a2', tags: [] },
      { front: 'q3', back: 'a3', tags: [] },
    ];
    const { added, duplicates, errors } = await addCards(cards, { url, deck: 'D', tags: ['batch'] });
    assert.equal(added, 2);
    assert.equal(duplicates, 1);
    assert.equal(errors.length, 0);
  });

  test('addCards sends Basic notes with allowDuplicate off and merged tags', async () => {
    seen.length = 0;
    await addCards([{ front: 'q', back: 'a', tags: ['t1'] }], { url, deck: 'D', tags: ['t0'] });
    const note = seen.find((s) => s.action === 'addNotes').params.notes[0];
    assert.equal(note.modelName, 'Basic');
    assert.equal(note.deckName, 'D');
    assert.deepEqual(note.fields, { Front: 'q', Back: 'a' });
    assert.deepEqual(note.tags, ['t0', 't1']);
    assert.equal(note.options.allowDuplicate, false);
  });

  test('addCards with no cards never contacts Anki', async () => {
    seen.length = 0;
    const { added } = await addCards([], { url, deck: 'D' });
    assert.equal(added, 0);
    assert.equal(seen.length, 0);
  });

  test('surfaces AnkiConnect errors and unreachable instances distinctly', async () => {
    await assert.rejects(ankiConnectError(), /unknown action/);
    await assert.rejects(checkConnection('http://127.0.0.1:1', opts), /cannot reach AnkiConnect/);
  });

  async function ankiConnectError() {
    const { ankiConnect } = await import('../src/anki.mjs');
    return ankiConnect(url, 'explode', {}, opts);
  }
});
