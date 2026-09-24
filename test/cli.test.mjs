import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, main, DEFAULT_ANKI_URL } from '../src/cli.mjs';

describe('parseArgs', () => {
  test('routes subcommands and collects files', () => {
    const a = parseArgs(['import', 'a.pdf', 'b.md', '--deck', 'D']);
    assert.equal(a.command, 'import');
    assert.deepEqual(a.files, ['a.pdf', 'b.md']);
    assert.equal(a.deck, 'D');
  });

  test('env provides generation defaults, flags override', () => {
    const env = { OPENAI_API_KEY: 'env-key', OPENAI_MODEL: 'env-model', ANKI_CONNECT_URL: 'http://x:1' };
    assert.equal(parseArgs(['import'], env).apiKey, 'env-key');
    assert.equal(parseArgs(['import'], env).model, 'env-model');
    assert.equal(parseArgs(['import'], env).ankiUrl, 'http://x:1');
    assert.equal(parseArgs(['import', '--api-key', 'flag', '--model', 'm2'], env).apiKey, 'flag');
    assert.equal(parseArgs(['import'], {}).ankiUrl, DEFAULT_ANKI_URL);
  });

  test('dry-run, tags, json and numbers parse', () => {
    const a = parseArgs(['import', '--dry-run', '--tags', 'a, b', '--json', '--max-cards-per-chunk', '7']);
    assert.equal(a.dryRun, true);
    assert.deepEqual(a.tags, ['a', 'b']);
    assert.equal(a.json, true);
    assert.equal(a.maxCardsPerChunk, 7);
  });

  test('unknown flags throw instead of being eaten', () => {
    assert.throws(() => parseArgs(['import', '--deck-nam', 'x']), /unknown flag/);
  });
});

describe('main', () => {
  test('no args prints help and exits 2', async () => {
    const lines = [];
    const orig = console.log;
    console.log = (m) => lines.push(m);
    try {
      assert.equal(await main([]), 2);
    } finally {
      console.log = orig;
    }
    assert.ok(lines[0].includes('anki-forge'));
  });

  test('import without --deck is a usage error (exit 2), not a crash', async () => {
    const errs = [];
    const orig = console.error;
    console.error = (m) => errs.push(m);
    try {
      assert.equal(await main(['import', 'x.pdf']), 2);
    } finally {
      console.error = orig;
    }
    assert.ok(errs[0].includes('--deck'));
  });

  test('import with a missing file reports the error and exits 2', async () => {
    const errs = [];
    const orig = console.error;
    console.error = (m) => errs.push(m);
    try {
      assert.equal(await main(['import', 'no-such-file.md', '--deck', 'D']), 2);
    } finally {
      console.error = orig;
    }
    assert.ok(errs[0].includes('ENOENT'));
  });

  test('import with an unsupported extension says which types exist', async () => {
    const errs = [];
    const orig = console.error;
    console.error = (m) => errs.push(m);
    try {
      assert.equal(await main(['import', 'file.docx', '--deck', 'D']), 2);
    } finally {
      console.error = orig;
    }
    assert.match(errs[0], /unsupported file type/);
  });
});
