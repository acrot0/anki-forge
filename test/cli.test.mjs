import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs, main, toArgv, wizard, expandInputs, DEFAULT_ANKI_URL } from '../src/cli.mjs';
import { applyProvider, PROVIDERS } from '../src/providers.mjs';

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

describe('providers', () => {
  test('--provider fills baseUrl and a model hint', () => {
    const args = parseArgs(['import', 'a.pdf', '--provider', 'deepseek']);
    applyProvider(args);
    assert.equal(args.baseUrl, PROVIDERS.deepseek.baseUrl);
    assert.equal(args.model, PROVIDERS.deepseek.hint);
  });

  test('explicit --base-url/--model win over the provider shortcut', () => {
    const args = parseArgs(['import', 'a.pdf', '--provider', 'openai', '--base-url', 'http://gw:1/v1', '--model', 'm']);
    applyProvider(args);
    assert.equal(args.baseUrl, 'http://gw:1/v1');
    assert.equal(args.model, 'm');
  });

  test('ollama is keyless and gets a placeholder bearer', () => {
    const args = parseArgs(['import', 'a.pdf', '--provider', 'ollama']);
    applyProvider(args);
    assert.equal(args.apiKey, 'ollama');
  });

  test('unknown provider names every known one', () => {
    const args = parseArgs(['import', 'a.pdf', '--provider', 'nope']);
    assert.throws(() => applyProvider(args), /deepseek, openai|openai, deepseek/);
  });
});

describe('toArgv (wizard output)', () => {
  test('round-trips through parseArgs preserving intent', () => {
    const argv = toArgv({
      files: ['a.pdf', 'b.md'], deck: 'D::E', dryRun: true,
      provider: 'deepseek', model: null, baseUrl: null, apiKey: 'k', language: null, ankiUrl: DEFAULT_ANKI_URL,
    });
    const back = parseArgs(argv, {});
    assert.deepEqual(back.files, ['a.pdf', 'b.md']);
    assert.equal(back.deck, 'D::E');
    assert.equal(back.dryRun, true);
    assert.equal(back.provider, 'deepseek');
    assert.equal(back.apiKey, 'k');
    assert.equal(back.ankiUrl, DEFAULT_ANKI_URL);
  });

  test('omits anki-url when it is the default', () => {
    const argv = toArgv({ files: ['a.md'], deck: 'D', ankiUrl: DEFAULT_ANKI_URL });
    assert.ok(!argv.includes('--anki-url'));
  });
});

describe('wizard', () => {
  const answers = (...list) => {
    let i = 0;
    return { question: async () => list[i++] ?? '' };
  };

  test('unknown provider aborts after retries, listing the options each time', async () => {
    const rl = answers('a.pdf', 'D', 'bad1', 'bad2', 'bad3');
    await assert.rejects(wizard([], { rl }), /too many invalid provider answers/);
  });

  test('no files aborts early', async () => {
    const rl = answers('', '', '');
    await assert.rejects(wizard([], { rl }), /no files given/);
  });

  test('a typo in provider is forgiven on the retry', async () => {
    // provider fixed on retry; then the flow proceeds into main() which
    // fails on the nonexistent file — a number exit code proves the wizard
    // got all the way through its questions and handed off.
    const rl = answers('a.md', 'D', 'deepseekk', 'deepseek', 'deepseek-chat', 'k', 'basic', 'n');
    const errs = [];
    const orig = console.error;
    console.error = (m) => errs.push(m);
    let code;
    try {
      code = await wizard([], { rl });
    } finally {
      console.error = orig;
    }
    assert.equal(typeof code, 'number', 'wizard must hand off to main and return its exit code');
    assert.ok(errs.some((e) => String(e).includes('ENOENT')), 'flow must reach file parsing');
  });
});

describe('expandInputs (folder import)', () => {
  test('expands directories recursively, skipping node_modules and hidden dirs', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'af-folders-'));
    await mkdir(path.join(root, 'week1'), { recursive: true });
    await mkdir(path.join(root, 'week2', 'sub'), { recursive: true });
    await mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true });
    await mkdir(path.join(root, '.hidden'), { recursive: true });
    await writeFile(path.join(root, 'week1', 'a.md'), '# A\n' + 'x'.repeat(300));
    await writeFile(path.join(root, 'week2', 'sub', 'b.txt'), 'hello world, enough text for parsing to be meaningful');
    await writeFile(path.join(root, 'week2', 'skip.exe'), 'binary');
    await writeFile(path.join(root, 'node_modules', 'pkg', 'c.md'), 'should be skipped');
    await writeFile(path.join(root, '.hidden', 'd.md'), 'should be skipped');

    const files = await expandInputs([root]);
    const names = files.map((f) => path.relative(root, f)).sort();
    assert.deepEqual(names, [path.join('week1', 'a.md'), path.join('week2', 'sub', 'b.txt')]);
  });

  test('plain files pass through untouched', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'af-folders-'));
    const f = path.join(root, 'single.md');
    await writeFile(f, '# S\n' + 'y'.repeat(300));
    assert.deepEqual(await expandInputs([f]), [f]);
  });

  test('a directory with nothing importable says so with the folder name', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'af-folders-'));
    await writeFile(path.join(root, 'only.exe'), 'binary');
    await assert.rejects(expandInputs([root]), /contains no importable files/);
  });

  test('missing paths pass through for parseFile to report ENOENT', async () => {
    assert.deepEqual(await expandInputs(['no-such-thing.md']), ['no-such-thing.md']);
  });
});

describe('main', () => {
  test('--interactive without a TTY fails loudly instead of blocking', async () => {
    const errs = [];
    const orig = console.error;
    console.error = (m) => errs.push(m);
    try {
      assert.equal(await main(['--interactive']), 2);
    } finally {
      console.error = orig;
    }
    assert.match(errs[0], /needs a terminal/);
  });

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
      assert.equal(await main(['import', 'file.ppt', '--deck', 'D']), 2);
    } finally {
      console.error = orig;
    }
    assert.match(errs[0], /unsupported file type/);
  });
});
