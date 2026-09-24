import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, main, toArgv, wizard, DEFAULT_ANKI_URL } from '../src/cli.mjs';
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
    return { question: async () => list[i++] };
  };

  test('unknown provider aborts without touching files', async () => {
    const rl = answers('a.pdf', 'D', 'not-a-provider');
    await assert.rejects(wizard([], { rl }), /unknown provider/);
  });

  test('no files aborts early', async () => {
    const rl = answers('');
    await assert.rejects(wizard([], { rl }), /no files/);
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
      assert.equal(await main(['import', 'file.docx', '--deck', 'D']), 2);
    } finally {
      console.error = orig;
    }
    assert.match(errs[0], /unsupported file type/);
  });
});
