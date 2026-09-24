#!/usr/bin/env node
/**
 * anki-forge — turn study files into Anki decks with your own LLM key.
 *
 *   anki-forge import lecture.pdf --deck "Med school::Cardio"
 *   anki-forge import notes.md textbook.txt --deck "考研政治" --dry-run
 *   anki-forge                    # interactive wizard
 *   anki-forge check
 *
 * Exit codes: 0 = ran (even with partial skips), 1 = nothing usable produced,
 * 2 = usage or environment error.
 */
import readline from 'node:readline/promises';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { checkConnection, ensureDeck, addCards } from './anki.mjs';
import { generateCards } from './generate.mjs';
import { loadCache } from './cache.mjs';
import { parseFile } from './parse.mjs';
import { PROVIDERS, applyProvider } from './providers.mjs';

export const DEFAULT_ANKI_URL = 'http://127.0.0.1:8765';

export function parseArgs(argv, env = process.env) {
  const out = {
    command: null,
    files: [],
    deck: null,
    dryRun: false,
    interactive: false,
    maxCardsPerChunk: null,
    language: null,
    provider: null,
    style: null,
    exportFile: null,
    noCache: false,
    baseUrl: env.OPENAI_BASE_URL ?? null,
    model: env.OPENAI_MODEL ?? null,
    apiKey: env.OPENAI_API_KEY ?? null,
    ankiUrl: env.ANKI_CONNECT_URL ?? DEFAULT_ANKI_URL,
    tags: [],
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => argv[++i];
    if (a === 'import' || a === 'check') out.command = a;
    else if (a === '--deck') out.deck = val();
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--interactive' || a === '-i') out.interactive = true;
    else if (a === '--max-cards-per-chunk') out.maxCardsPerChunk = Number(val());
    else if (a === '--language') out.language = val();
    else if (a === '--provider') out.provider = val();
    else if (a === '--style') out.style = val();
    else if (a === '--export') out.exportFile = val();
    else if (a === '--no-cache') out.noCache = true;
    else if (a === '--base-url') out.baseUrl = val();
    else if (a === '--model') out.model = val();
    else if (a === '--api-key') out.apiKey = val();
    else if (a === '--anki-url') out.ankiUrl = val();
    else if (a === '--tags') out.tags = String(val()).split(',').map((t) => t.trim()).filter(Boolean);
    else if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') out.command = 'help';
    else if (a.startsWith('-')) throw new Error(`unknown flag ${a}`);
    else out.files.push(a);
  }
  return out;
}

function summarize(perChunk, label) {
  const failed = perChunk.filter((c) => c.error);
  if (failed.length === 0) return;
  console.error(`\n  ${failed.length} of ${perChunk.length} chunks failed (${label}):`);
  for (const f of failed.slice(0, 5)) console.error(`    - ${f.title || '(untitled)'}: ${f.error}`);
  if (failed.length > 5) console.error(`    ... and ${failed.length - 5} more`);
}

export function toArgv(args) {
  const argv = ['import', ...args.files];
  if (args.deck) argv.push('--deck', args.deck);
  if (args.dryRun) argv.push('--dry-run');
  if (args.provider) argv.push('--provider', args.provider);
  if (args.baseUrl) argv.push('--base-url', args.baseUrl);
  if (args.model) argv.push('--model', args.model);
  if (args.apiKey) argv.push('--api-key', args.apiKey);
  if (args.language) argv.push('--language', args.language);
  if (args.style) argv.push('--style', args.style);
  if (args.exportFile) argv.push('--export', args.exportFile);
  if (args.noCache) argv.push('--no-cache');
  if (args.ankiUrl !== DEFAULT_ANKI_URL) argv.push('--anki-url', args.ankiUrl);
  return argv;
}

/**
 * Interactive wizard: question order is deliberately short. Returns the final
 * argv (dry-run first unless the user opts straight in), so the whole flow
 * re-enters main() and there is exactly one code path that touches Anki.
 */
export async function wizard(argvIn, { rl = null } = {}) {
  const own = !rl;
  rl ??= readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (q, fallback) => {
    const suffix = fallback !== undefined && fallback !== '' ? ` [${fallback}]` : '';
    const a = (await rl.question(`${q}${suffix}: `)).trim();
    return a || (fallback ?? '');
  };
  try {
    console.log('anki-forge — study files → Anki deck. ENTER accepts the [suggestion].\n');
    const out = {};
    out.files = String(await ask('File(s) to import (comma-separated, .pdf/.md/.txt)')).split(',').map((f) => f.trim()).filter(Boolean);
    if (out.files.length === 0) throw new Error('no files given');
    out.deck = await ask('Deck name ("::" nests)', 'Imported');

    const names = Object.keys(PROVIDERS);
    console.log(`  providers: ${names.join(', ')}`);
    out.provider = (await ask('Provider', 'deepseek')).toLowerCase();
    if (!PROVIDERS[out.provider]) throw new Error(`unknown provider "${out.provider}" — known: ${names.join(', ')}`);
    out.model = await ask('Model', PROVIDERS[out.provider].hint);
    out.apiKey = await ask('API key (ENTER = $OPENAI_API_KEY)', process.env.OPENAI_API_KEY ?? '');
    if (!out.apiKey && !PROVIDERS[out.provider].keyless) throw new Error('no API key');
    out.style = (await ask('Card style: basic = Q/A, cloze = fill-in-the-blank', 'basic')).toLowerCase();
    if (!['basic', 'cloze'].includes(out.style)) throw new Error('card style must be basic or cloze');

    const preview = (await ask('Preview cards first, write nothing yet (Y/n)', 'Y')).toLowerCase();
    const argv = toArgv({ ...out, dryRun: preview !== 'n' });
    const code = await main(argv, process.env);
    if (code !== 0) return code;
    if (preview !== 'n') {
      const go = (await ask('\nWrite these into Anki now? (y/N)', 'N')).toLowerCase();
      if (go === 'y') return main(toArgv({ ...out, dryRun: false }), process.env);
    }
    return code;
  } finally {
    if (own) rl.close();
  }
}

async function runImport(args) {
  if (!args.deck) throw new Error('import requires --deck <name> (use :: for nesting, e.g. "Med::Cardio")');
  if (args.files.length === 0) throw new Error('import requires at least one file (.pdf, .md, .txt)');
  applyProvider(args);

  const allChunks = [];
  for (const file of args.files) {
    const { chunks, kind } = await parseFile(file);
    console.error(`  ${file}: ${chunks.length} chunks (${kind})`);
    allChunks.push(...chunks.map((c) => ({ ...c, file })));
  }
  if (allChunks.length === 0) {
    console.error('no content extracted — nothing to do');
    return 1;
  }

  console.error(`  ${allChunks.length} chunks → up to ${allChunks.length} LLM calls`);
  const cache = args.noCache ? null : await loadCache();
  const { cards, perChunk } = await generateCards(allChunks, args, { cache });
  if (cache) await cache.save();
  summarize(perChunk, 'generation');
  const cachedCount = perChunk.filter((c) => c.cached).length;
  if (cachedCount > 0) console.error(`  ${cachedCount} of ${allChunks.length} chunks served from cache (no cost)`);
  if (cards.length === 0) {
    console.error('the model produced no usable cards — check --model and the material');
    return 1;
  }

  if (args.exportFile) {
    const tsv = cards
      .map((c) => [c.front, c.back, [...args.tags, ...c.tags].join(' ')].join('\t'))
      .join('\n');
    await writeFile(args.exportFile, tsv, 'utf8');
    console.log(`exported ${cards.length} cards to ${args.exportFile} — Anki: File → Import (field separator Tab)`);
    return 0;
  }

  if (args.dryRun) {
    const preview = cards.slice(0, 10);
    for (const c of preview) {
      console.log(`  Q: ${c.front}\n  A: ${c.back}${c.tags.length ? `  [${c.tags.join(', ')}]` : ''}\n`);
    }
    if (cards.length > preview.length) console.log(`  ... and ${cards.length - preview.length} more`);
    console.log(`dry run: ${cards.length} cards ready, nothing written (--deck ${args.deck})`);
    return 0;
  }

  await checkConnection(args.ankiUrl);
  const { created } = await ensureDeck(args.deck, { url: args.ankiUrl });
  console.error(`  deck ${args.deck}${created ? ' created' : ' exists'}`);

  const { added, duplicates, errors } = await addCards(cards, {
    url: args.ankiUrl,
    deck: args.deck,
    tags: args.tags,
  });
  console.log(`done: ${added} added, ${duplicates} duplicates skipped${errors.length ? `, ${errors.length} rejected` : ''} (of ${cards.length} generated)`);
  return 0;
}

async function runCheck(args) {
  applyProvider(args);
  const { version } = await checkConnection(args.ankiUrl);
  console.log(`AnkiConnect OK (${args.ankiUrl}, protocol v${version})`);
  if (!args.apiKey) console.log('no API key yet — generation will fail until --api-key or $OPENAI_API_KEY is set');
  if (!args.model) console.log('no model configured — pass --model, --provider, or $OPENAI_MODEL');
  return 0;
}

const HELP = `anki-forge — turn textbooks and lecture notes into Anki decks, with your own LLM key.

  anki-forge                               interactive wizard
  anki-forge import <file...> --deck <name> [options]
  anki-forge check

Import options:
  --deck <name>            target deck, "::" nests ("Med::Cardio")   required
  --dry-run                generate and preview, write nothing
  --style basic|cloze      cloze generates {{c1::...}} fill-in cards (default basic)
  --export <file>          write cards to a TSV file instead of Anki
  --no-cache               re-call the LLM even if this exact section is cached
  --max-cards-per-chunk N  cap per section (default 10)
  --language LANG          force card language, default follows the material
  --tags a,b               extra tags on every card
Generation (any OpenAI-compatible endpoint):
  --provider NAME          shortcut for known endpoints: ${Object.keys(PROVIDERS).join(', ')}
  --base-url URL           default $OPENAI_BASE_URL or https://api.openai.com/v1
  --model NAME             default $OPENAI_MODEL (required)
  --api-key KEY            default $OPENAI_API_KEY                    required
Anki:
  --anki-url URL           default $ANKI_CONNECT_URL or http://127.0.0.1:8765
                           (requires Anki desktop running with the AnkiConnect add-on)
`;

export async function main(argv = process.argv.slice(2), env = process.env, { rl = null } = {}) {
  let args;
  try {
    args = parseArgs(argv, env);
  } catch (e) {
    console.error(`error: ${e.message}`);
    return 2;
  }
  if (args.command === 'help') {
    console.log(HELP);
    return 0;
  }
  if (!args.command) {
    // The wizard needs a terminal. Piped/CI stdin is not one — silently
    // blocking on a question there would hang the process instead of failing.
    const tty = Boolean(process.stdin?.isTTY);
    if (args.interactive) {
      if (!tty) {
        console.error('--interactive needs a terminal (stdin is not a TTY)');
        return 2;
      }
      return wizard(argv, { rl });
    }
    if (argv.length === 0 && tty) return wizard(argv, { rl });
    console.log(HELP);
    return 2;
  }
  try {
    return args.command === 'check' ? await runCheck(args) : await runImport(args);
  } catch (e) {
    console.error(`error: ${e.message}`);
    return 2;
  }
}

// No top-level await here on purpose: the SEA single-file build bundles this
// module to CJS, which cannot express it. main() handles its own errors.
const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
