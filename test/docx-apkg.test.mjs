import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readZip } from '../src/zip.mjs';
import { createZip } from '../src/zip-write.mjs';
import { writeApkgBytes } from '../src/apkg.mjs';
import { parseDocx } from '../src/parse.mjs';
import { makeZip } from './helpers/zip-fixtures.mjs';

async function openCollection(bytes) {
  const dir = await mkdtemp(path.join(tmpdir(), 'af-verify-'));
  const dbPath = path.join(dir, 'c.anki2');
  await writeFile(dbPath, readZip(bytes).get('collection.anki2'));
  const { DatabaseSync } = await import('node:sqlite');
  return new DatabaseSync(dbPath, { readOnly: true });
}

describe('zip writer', () => {
  test('round-trips through our own reader, byte content intact', () => {
    const entries = [
      { name: 'a.txt', data: 'plain text' },
      { name: 'nested/dir/b.bin', data: Buffer.from([1, 2, 3, 255, 0]) },
    ];
    const out = createZip(entries);
    const zip = readZip(out);
    assert.equal(zip.get('a.txt').toString('utf8'), 'plain text');
    assert.deepEqual([...zip.get('nested/dir/b.bin')], [1, 2, 3, 255, 0]);
  });
});

describe('apkg export', () => {
  const cards = [
    { front: 'What is ATP?', back: 'The energy currency of the cell.', tags: ['bio'] },
    { front: 'DNA is {{c1::deoxyribonucleic}} acid.', back: '', tags: [] },
  ];

  test('collection is schema 11 with the target deck and all cards', async () => {
    const bytes = await writeApkgBytes(cards, { deckName: 'Exam::Chapter 1', style: 'basic' });
    const zip = readZip(bytes);
    assert.deepEqual([...zip.keys()].sort(), ['collection.anki2', 'media']);
    assert.equal(zip.get('media').toString(), '{}');
    const db = await openCollection(bytes);
    try {
      const col = db.prepare('SELECT ver, conf, models, decks FROM col').get();
      assert.equal(col.ver, 11);
      const decks = Object.values(JSON.parse(col.decks)).map((d) => d.name);
      assert.ok(decks.includes('Exam::Chapter 1'), 'target deck must exist in the file');
      assert.equal(JSON.parse(col.conf).curDeck, Object.values(JSON.parse(col.decks)).find((d) => d.name === 'Exam::Chapter 1').id);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM notes').get().n, 2);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM cards').get().n, 2);
      const note = db.prepare('SELECT flds, csum FROM notes ORDER BY id LIMIT 1').get();
      assert.equal(note.flds.split('\u001f')[0], 'What is ATP?');
      assert.equal(note.csum, Number.parseInt((await import('node:crypto')).createHash('sha1').update('What is ATP?').digest('hex').slice(0, 8), 16));
    } finally {
      db.close();
    }
  });

  test('cloze style writes a cloze notetype (type 1, Text/Extra)', async () => {
    const bytes = await writeApkgBytes(cards, { deckName: 'D', style: 'cloze' });
    const db = await openCollection(bytes);
    try {
      const model = Object.values(JSON.parse(db.prepare('SELECT models FROM col').get().models))[0];
      assert.equal(model.type, 1);
      assert.deepEqual(model.flds.map((f) => f.name), ['Text', 'Extra']);
      assert.ok(model.css.includes('.nightMode'), 'dark-mode css must ship with the model');
      assert.ok(model.tmpls[0].afmt.includes('class="a"'), 'structured answer markup');
      assert.ok(model.tmpls[0].qfmt.includes('{{cloze:Text}}'), 'cloze template must use the cloze filter');
    } finally {
      db.close();
    }
  });

  test('vocab style writes a four-field word notetype', async () => {
    const bytes = await writeApkgBytes([{ word: 'abandon', phonetic: '/əˈbændən/', definition: 'v. 放弃', example: 'Abandon ship.', tags: [] }], { deckName: 'D', style: 'vocab' });
    const db = await openCollection(bytes);
    try {
      const model = Object.values(JSON.parse(db.prepare('SELECT models FROM col').get().models))[0];
      assert.equal(model.name, 'anki-forge Vocab');
      assert.deepEqual(model.flds.map((f) => f.name), ['Word', 'Phonetic', 'Definition', 'Example']);
      const note = db.prepare('SELECT flds, sfld FROM notes LIMIT 1').get();
      assert.equal(note.flds.split('\u001f')[0], 'abandon');
      assert.equal(note.sfld, 'abandon');
    } finally {
      db.close();
    }
  });

  test('note ids are unique and card due preserves insertion order', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ front: `q${i}`, back: `a${i}`, tags: [] }));
    const bytes = await writeApkgBytes(many, { deckName: 'D', style: 'basic' });
    const db = await openCollection(bytes);
    try {
      const notes = db.prepare('SELECT id FROM notes ORDER BY id').all();
      assert.equal(new Set(notes.map((n) => n.id)).size, 30, 'ids must not collide');
      const due = db.prepare('SELECT due FROM cards ORDER BY id').all().map((c) => c.due);
      assert.deepEqual(due, Array.from({ length: 30 }, (_, i) => i + 1));
    } finally {
      db.close();
    }
  });
});

describe('docx parsing', () => {
  test('paragraphs become lines, runs inside one paragraph merge', () => {
    const docx = makeZip([
      { name: 'word/document.xml', data: Buffer.from(
        `<w:document><w:body>` +
        `<w:p><w:r><w:t>Chapter 1 Intro</w:t></w:r></w:p>` +
        `<w:p><w:r><w:t>A cell is the basic unit of life. </w:t></w:r><w:r><w:t>It carries DNA.</w:t></w:r></w:p>` +
        `<w:p><w:r><w:t>&amp; entities &lt;work&gt; too.</w:t></w:r></w:p>` +
        `</w:body></w:document>`) },
    ]);
    const chunks = parseDocx(docx);
    assert.ok(chunks.length >= 1);
    assert.ok(chunks[0].text.includes('A cell is the basic unit of life. It carries DNA.'));
    assert.ok(chunks[0].text.includes('& entities <work> too.'));
  });

  test('a zip without the document part says so', () => {
    assert.throws(() => parseDocx(makeZip([{ name: 'x.xml', data: Buffer.from('<x/>') }])), /no word\/document.xml/);
  });
});
