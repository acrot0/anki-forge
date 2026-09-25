/**
 * Study sessions with FSRS scheduling (ts-fsrs, MIT) — the actual learning
 * loop, not just export. Progress persists per deck in
 * ~/.anki-forge/study/<hash>.json so review history survives restarts.
 *
 * Cards are identified by their front text hash, so re-generating the same
 * material resumes the same study state instead of resetting it.
 */
import { createHash } from 'node:crypto';
import { fsrs, generatorParameters, createEmptyCard, Rating, State } from 'ts-fsrs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const Grades = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy];
const GRADE_LABELS = { 1: '忘记', 2: '困难', 3: '良好', 4: '简单' };
const f = fsrs(generatorParameters({ enable_fuzz: true }));

export const studyDir = () => path.join(os.homedir(), '.anki-forge', 'study');
export const deckFile = (deck) => path.join(studyDir(), deckHash(deck) + '.json');
export const deckHash = (deck) => createHash('sha256').update(deck).digest('hex').slice(0, 16);

const cardKey = (front) => createHash('sha256').update(String(front)).digest('hex').slice(0, 20);

async function loadDeckState(deck) {
  try {
    return JSON.parse(await readFile(deckFile(deck), 'utf8'));
  } catch {
    return { deck, cards: {}, history: [] }; // cards: key -> {data, fsrs, reps}
  }
}

async function saveDeckState(deck, state) {
  await mkdir(studyDir(), { recursive: true });
  await writeFile(deckFile(deck), JSON.stringify(state));
}

/**
 * Merge generated cards into the deck's study state. Existing cards keep
 * their FSRS scheduling — re-generating material never resets progress.
 * Returns a snapshot with due/new breakdown for the UI.
 */
export async function startStudy(deck, cards) {
  const state = await loadDeckState(deck);
  let added = 0;
  for (const c of cards) {
    const key = cardKey(c.front);
    if (!state.cards[key]) {
      state.cards[key] = {
        data: { front: c.front, back: c.back ?? '', tags: c.tags ?? [], source: c.source ?? '' },
        fsrs: createEmptyCard(new Date()),
        reps: 0,
      };
      added++;
    } else {
      // refresh content but keep scheduling
      state.cards[key].data = { front: c.front, back: c.back ?? '', tags: c.tags ?? [], source: c.source ?? '' };
    }
  }
  await saveDeckState(deck, state);
  return snapshot(deck, state, added);
}

function snapshot(deck, state, added = 0) {
  const now = Date.now();
  const all = Object.entries(state.cards).map(([key, c]) => ({
    key,
    front: c.data.front,
    back: c.data.back,
    tags: c.data.tags ?? [],
    source: c.data.source ?? '',
    state: c.fsrs.state,
    due: c.fsrs.due,
    reps: c.reps,
  }));
  const due = all
    .filter((c) => new Date(c.due).getTime() <= now)
    .sort((a, b) => new Date(a.due) - new Date(b.due));
  return {
    deck,
    total: all.length,
    newCount: all.filter((c) => c.state === State.New).length,
    learningCount: all.filter((c) => c.state === State.Learning || c.state === State.Relearning).length,
    reviewCount: all.filter((c) => c.state === State.Review).length,
    dueNow: due.length,
    added,
    queue: due.slice(0, 50).map((c) => ({ key: c.key, front: c.front, back: c.back, tags: c.tags, source: c.source, state: c.state, reps: c.reps })),
  };
}

/** Get the current study queue for a deck (for the UI's study mode). */
export async function getQueue(deck) {
  const state = await loadDeckState(deck);
  return snapshot(deck, state);
}

/** Apply a grade to one card: advances FSRS and records history. */
export async function gradeCard(deck, front, rating) {
  if (!Grades.includes(rating)) throw new Error('rating must be 1-4');
  const state = await loadDeckState(deck);
  const key = cardKey(front);
  const entry = state.cards[key];
  if (!entry) throw new Error('card not in study set — start the deck first');
  const item = f.next(entry.fsrs, new Date(), rating);
  entry.fsrs = item.card;
  entry.reps = (entry.reps ?? 0) + 1;
  state.history.push({ key, rating, label: GRADE_LABELS[rating], at: Date.now(), state: item.card.state });
  if (state.history.length > 2000) state.history = state.history.slice(-1000);
  await saveDeckState(deck, state);
  return {
    ok: true,
    state: Object.keys(State)[item.card.state] ?? item.card.state,
    due: item.card.due,
    stability: item.card.stability != null ? Number(item.card.stability.toFixed(2)) : null,
  };
}
