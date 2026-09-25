import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startStudy, getQueue, gradeCard, deckFile } from '../src/study.mjs';

// study.mjs reads a fixed home dir; tests run against a temp HOME via env is
// not possible post-import, so we assert on real files under the user's
// .anki-forge/study with unique deck names per run.
const RUN = Math.random().toString(36).slice(2, 8);
const deckA = 'Test::DeckA-' + RUN;
const deckB = 'Test::DeckB-' + RUN;

const cards = [
  { front: 'What is FSRS?', back: 'A modern spaced repetition scheduler.', tags: ['algo'], source: 'Ch1' },
  { front: 'What is Anki?', back: 'A flashcard program.', tags: [], source: 'Ch1' },
];

describe('study sessions (FSRS)', () => {
  test('start creates queue with new cards and persists state', async () => {
    const snap = await startStudy(deckA, cards);
    assert.equal(snap.total, 2);
    assert.equal(snap.newCount, 2);
    assert.equal(snap.dueNow, 2, 'new cards are immediately due');
    assert.equal(snap.queue[0].front, 'What is FSRS?');
    const state = JSON.parse(await readFile(deckFile(deckA), 'utf8'));
    assert.ok(Object.keys(state.cards).length === 2);
  });

  test('re-generating the same material adds nothing but keeps progress', async () => {
    const snap = await startStudy(deckA, cards.map(c => ({ ...c })));
    assert.equal(snap.added, 0, 'same fronts must not duplicate');
    assert.equal(snap.total, 2);
  });

  test('grading Good advances state and due date moves forward', async () => {
    const before = await getQueue(deckA);
    const card = before.queue[0];
    const r = await gradeCard(deckA, card.front, 3);
    assert.equal(r.ok, true);
    assert.ok(r.due, 'FSRS must produce a due date');
    const after = await getQueue(deckA);
    assert.equal(after.dueNow, before.dueNow - 1, 'graded card leaves the due queue');
  });

  test('different decks are isolated', async () => {
    const snap = await startStudy(deckB, [{ front: 'DeckB card', back: 'b', tags: [] }]);
    assert.equal(snap.total, 1);
    assert.notEqual(deckFile(deckA), deckFile(deckB));
  });

  test('bad ratings are rejected', async () => {
    await assert.rejects(gradeCard(deckA, 'What is FSRS?', 9), /rating must be 1-4/);
  });

  test('unknown deck path stays isolated per deck hash', () => {
    assert.ok(deckFile('X') !== deckFile('Y'));
    assert.equal(path.basename(deckFile('X')).length, 16 + 5);
  });
});
