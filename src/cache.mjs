/**
 * Response cache for generateCards: key = cacheKey(chunk, opts), value = the
 * raw card array. Stored as one JSON file so the user can inspect or delete
 * it; it contains card text (i.e. excerpts of their study material) — README
 * says so. Bounded: past the entry cap the oldest half is dropped, keeping
 * long-term usage from growing without limit.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export const MAX_ENTRIES = 3000;

export const cachePath = () => path.join(os.homedir(), '.anki-forge', 'cache-v1.json');

export async function loadCache(file = cachePath()) {
  let data = {};
  try {
    data = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    /* missing or unreadable cache is a cold cache, not an error */
  }
  const order = Object.keys(data);
  const get = (key) => data[key];
  const set = (key, value) => {
    if (!(key in data)) order.push(key);
    data[key] = value;
  };
  const save = async () => {
    const keys = order.filter((k) => k in data);
    if (keys.length > MAX_ENTRIES) {
      for (const k of keys.slice(0, keys.length - MAX_ENTRIES / 2)) delete data[k];
    }
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(data));
  };
  return { get, set, save };
}
