/**
 * .apkg export — a deck file Anki can import directly (File → Import), no
 * running desktop app needed. Enables sharing decks and mobile-only workflows.
 *
 * Format facts, verified against a real local collection (read-only dump):
 * an .apkg is a ZIP with `collection.anki2` (SQLite, schema ver 11 — the
 * legacy format every genanki-class tool writes; Anki upgrades it on import)
 * and a `media` manifest ("{}" when there are no media files).
 * Column names of notes/cards are identical from v11 through v18.
 *
 * Notes get fresh ids and random guids; `type=0/queue=0/due=i` means "new
 * card, learning position i" — importing never touches review history.
 */
// node:sqlite is experimental and prints an ExperimentalWarning to stderr on
// first use — noise on every run of an otherwise quiet CLI. The handler must
// be registered before the module is loaded, so node:sqlite is imported
// lazily inside getDb(); a static import would hoist ahead of any code here.
// (Same suppression pattern ccr-toolkit uses.)
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (!(w?.name === 'ExperimentalWarning' && /SQLite/i.test(w.message))) console.warn(w);
});

let _DatabaseSync = null;
async function getDatabaseSync() {
  if (!_DatabaseSync) ({ DatabaseSync: _DatabaseSync } = await import('node:sqlite'));
  return _DatabaseSync;
}
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createZip } from './zip-write.mjs';

const SCHEMA = `
CREATE TABLE col (
    id integer PRIMARY KEY,
    crt integer NOT NULL,
    mod integer NOT NULL,
    scm integer NOT NULL,
    ver integer NOT NULL,
    dty integer NOT NULL,
    usn integer NOT NULL,
    ls integer NOT NULL,
    conf text NOT NULL,
    models text NOT NULL,
    decks text NOT NULL,
    dconf text NOT NULL
);
CREATE TABLE notes (
    id integer PRIMARY KEY,
    guid text NOT NULL,
    mid integer NOT NULL,
    mod integer NOT NULL,
    usn integer NOT NULL,
    tags text NOT NULL,
    flds text NOT NULL,
    sfld integer NOT NULL,
    csum integer NOT NULL,
    flags integer NOT NULL,
    data text NOT NULL
);
CREATE TABLE cards (
    id integer PRIMARY KEY,
    nid integer NOT NULL,
    did integer NOT NULL,
    ord integer NOT NULL,
    mod integer NOT NULL,
    usn integer NOT NULL,
    type integer NOT NULL,
    queue integer NOT NULL,
    due integer NOT NULL,
    ivl integer NOT NULL,
    factor integer NOT NULL,
    reps integer NOT NULL,
    lapses integer NOT NULL,
    left integer NOT NULL,
    odue integer NOT NULL,
    odid integer NOT NULL,
    flags integer NOT NULL,
    data text NOT NULL
);
CREATE TABLE revlog (
    id integer PRIMARY KEY,
    cid integer NOT NULL,
    usn integer NOT NULL,
    ease integer NOT NULL,
    ivl integer NOT NULL,
    lastIvl integer NOT NULL,
    factor integer NOT NULL,
    time integer NOT NULL,
    type integer NOT NULL
);
CREATE TABLE graves (
    usn integer NOT NULL,
    oid integer NOT NULL,
    type integer NOT NULL
);
CREATE INDEX idx_notes_mid ON notes (mid);
CREATE INDEX idx_cards_nid ON cards (nid);
CREATE INDEX idx_cards_sched ON cards (did, queue, due);
`;

const nowSecs = () => Math.floor(Date.now() / 1000);

/** URL-safe random guid, same idea as genanki's but without base91. */
const newGuid = () => randomBytes(10).toString('base64url');

const CARD_CSS = `
.card {
  font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 19px; line-height: 1.55; text-align: center;
  color: #1e2233; background: #f6f7fb; padding: 28px 18px;
}
.q { font-weight: 600; }
hr#answer { border: 0; border-top: 2px dashed #c7d2fe; margin: 18px 30%; }
.a { color: #374151; }
.tags { margin-top: 18px; font-size: 12px; color: #6b7280; }
.tags .tag { background: #eef2ff; color: #4f46e5; border-radius: 6px; padding: 2px 9px; margin: 0 3px; display: inline-block; }
.cloze { color: #4f46e5; font-weight: 700; }
.nightMode .card { color: #e7e9f0; background: #171a23; }
.nightMode .a { color: #c7cbda; }
.nightMode hr#answer { border-top-color: #3730a3; }
.nightMode .tags .tag { background: #1e2140; color: #a5b4fc; }
.nightMode .cloze { color: #a5b4fc; }`;

function modelJson(mid, name, style, now) {
  if (style === 'vocab') {
    return {
      [mid]: {
        id: Number(mid),
        name,
        type: 0,
        mod: now,
        usn: -1,
        sortf: 0,
        did: null,
        css: CARD_CSS + `
.word { font-size: 30px; font-weight: 700; letter-spacing: .5px; }
.phonetic { color: #6b7280; font-size: 16px; margin-top: 4px; }
.example { margin-top: 12px; font-style: italic; color: #6b7280; font-size: 16px; }
.nightMode .word { color: #a5b4fc; }`,
        tmpls: [{
          name: 'Card 1', ord: 0,
          qfmt: '<div class="word">{{Word}}</div><div class="phonetic">{{Phonetic}}</div>',
          afmt: '<div class="word">{{Word}}</div><div class="phonetic">{{Phonetic}}</div><hr id="answer"><div class="a">{{Definition}}</div><div class="example">{{Example}}</div><div class="tags">{{Tags}}</div>',
          bqfmt: '', bafmt: '', did: null,
        }],
        flds: ['Word', 'Phonetic', 'Definition', 'Example'].map((f, ord) => ({
          name: f, ord, sticky: false, rtl: false, font: 'Arial', size: 20, media: [],
        })),
        tags: [],
        latexPre: '\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n',
        latexPost: '\\end{document}',
        req: [[0, 'any', [0]]],
      },
    };
  }
  const fields = style === 'cloze'
    ? ['Text', 'Extra']
    : ['Front', 'Back'];
  const qfmt = style === 'cloze'
    ? '<div class="q">{{cloze:Text}}</div>'
    : '<div class="q">{{Front}}</div>';
  const afmt = style === 'cloze'
    ? '<div class="q">{{cloze:Text}}</div><hr id="answer"><div class="a">{{Extra}}</div><div class="tags">{{Tags}}</div>'
    : '<div class="q">{{Front}}</div><hr id="answer"><div class="a">{{Back}}</div><div class="tags">{{Tags}}</div>';
  return {
    [mid]: {
      id: Number(mid),
      name,
      type: style === 'cloze' ? 1 : 0, // 1 = cloze: Anki requires it for {{cloze:}} to render
      mod: now,
      usn: -1,
      sortf: 0,
      did: null,
      css: CARD_CSS,
      tmpls: [{ name: 'Card 1', ord: 0, qfmt, afmt, bqfmt: '', bafmt: '', did: null }],
      flds: fields.map((f, ord) => ({
        name: f, ord, sticky: false, rtl: false, font: 'Arial', size: 20, media: [],
      })),
      tags: [],
      latexPre: '\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n',
      latexPost: '\\end{document}',
      req: [[0, 'any', [0]]],
    },
  };
}

function deckJson(id, name, now) {
  return {
    [id]: {
      id, name, mod: now, usn: -1,
      lrnToday: [0, 0], revToday: [0, 0], newToday: [0, 0], timeToday: [0, 0],
      collapsed: false, browserCollapsed: false, learnTomorrow: false,
      dyn: 0, conf: 1, extendNew: 10, extendRev: 50, desc: '',
    },
  };

}

const DEFAULT_DCONF = {
  1: {
    id: 1, name: 'Default', mod: 0, usn: 0, maxTaken: 60, autoplay: true, timer: 0, replayq: true,
    new: { bury: true, delays: [1, 10], initialFactor: 2500, ints: [1, 4, 7], order: 1, perDay: 20, separate: true },
    rev: { perDay: 100, fuzz: 0.05, ivlFct: 1, maxIvl: 36500, ease4: 1.3, bury: true, minSpace: 1, tod: 0 },
    lapse: { delays: [10], mult: 0, minInt: 1, leechFails: 8, leechAction: 0 },
  },
};

/**
 * Build the .apkg bytes. `deckName` becomes a deck in the file, so importing
 * on any device lands the cards in the right place without extra clicks.
 * node:sqlite on this Node has no in-memory serialize(), so the collection is
 * materialized to a temp file and read back — same bytes, same format.
 */
export async function writeApkgBytes(cards, { deckName, style = 'basic' } = {}) {
  const now = nowSecs();
  const nowMs = Date.now();
  const mid = nowMs;
  const modelId = String(mid);
  const did = nowMs + 1;
  const modelName = style === 'cloze' ? 'anki-forge Cloze' : style === 'vocab' ? 'anki-forge Vocab' : 'anki-forge Basic';
  const model = modelJson(modelId, modelName, style, now);
  const decks = {
    ...deckJson(1, 'Default', now),
    ...deckJson(did, deckName, now),
  };
  const colConf = {
    nextPos: 1, estTimes: true, activeDecks: [1], sortType: 'noteFld', timeLim: 0,
    sortBackwards: false, addToCur: false, curDeck: did, newBury: true, newSpread: 0,
    dueCounts: true, curModel: modelId, collapseTime: 1200,
  };

  const dir = await mkdtemp(path.join(tmpdir(), 'anki-forge-'));
  const dbPath = path.join(dir, 'collection.anki2');
  const DatabaseSync = await getDatabaseSync();
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);
  db.prepare('INSERT INTO col (id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf) VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?)')
    .run(now, now, now, JSON.stringify(colConf), JSON.stringify(model), JSON.stringify(decks), JSON.stringify(DEFAULT_DCONF));

  const insNote = db.prepare('INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data) VALUES (?, ?, ?, ?, -1, ?, ?, ?, ?, 0, \'\')');
  const insCard = db.prepare('INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data) VALUES (?, ?, ?, 0, ?, -1, 0, 0, ?, 0, 0, 0, 0, 0, 0, 0, 0, \'\')');
  // Vocab cards carry their own field shape; basic/cloze use front/back.
  const fldsOf = style === 'vocab'
    ? (c) => [c.word ?? '', c.phonetic ?? '', c.definition ?? c.back ?? '', c.example ?? '']
    : style === 'cloze'
      ? (c) => [c.front, c.back ?? '']
      : (c) => [c.front, c.back];
  const sfldOf = style === 'vocab' ? (c) => c.word ?? '' : (c) => c.front;
  // One transaction for the whole batch: a thousand-card deck otherwise pays
  // a fsync per row, which is the difference between seconds and minutes.
  db.exec('BEGIN');
  try {
    cards.forEach((c, i) => {
      const nid = nowMs + i;
      const flds = fldsOf(c).join('\u001f');
      const tags = [...(c.tags ?? [])].join(' ');
      const csum = Number.parseInt(createHash('sha1').update(sfldOf(c)).digest('hex').slice(0, 8), 16);
      insNote.run(nid, newGuid(), mid, now, tags, flds, sfldOf(c), csum);
      // due = i+1: new-card position in insertion order, mirroring what Anki
      // does for fresh imports.
      insCard.run(nowMs + 1_000_000 + i, nid, did, now, i + 1);
    });
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  db.close();
  const anki2 = await readFile(dbPath);
  await rm(dir, { recursive: true, force: true });
  return createZip([
    { name: 'collection.anki2', data: anki2 },
    { name: 'media', data: '{}' },
  ]);
}
