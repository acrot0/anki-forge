#!/usr/bin/env node
/**
 * anki-forge — turn study files into Anki decks with your own LLM key.
 *
 *   anki-forge import lecture.pdf --deck "Med school::Cardio"
 *   anki-forge import notes.md textbook.txt --deck "考研政治" --dry-run
 *   anki-forge check
 *
 * Exit codes: 0 = ran (even with partial skips), 1 = nothing usable produced,
 * 2 = usage or environment error.
 */
import { checkConnection, ensureDeck, addCards } from './anki.mjs';
import { generateCards } from './generate.mjs';
import { parseFile, MIN_CHARS } from './parse.mjs';

export const DEFAULT_ANKI_URL = 'http://127.0.0.1:8765';

export function parseArgs(argv, env = process.env) {
  const out = {
    command: null,
    files: [],
    deck: null,
    dryRun: false,
    maxCardsPerChunk: null,
    language: null,
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
    else if (a === '--max-cards-per-chunk') out.maxCardsPerChunk = Number(val());
    else if (a === '--language') out.language = val();
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

async function runImport(args) {
  if (!args.deck) throw new Error('import requires --deck <name> (use :: for nesting, e.g. "Med::Cardio")');
  if (args.files.length === 0) throw new Error('import requires at least one file (.pdf, .md, .txt)');

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

  console.error(`  generating cards with ${args.model} (${args.dryRun ? 'dry run — nothing written' : 'will write to Anki'})...`);
  const { cards, perChunk } = await generateCards(allChunks, args);
  summarize(perChunk, 'generation');
  if (cards.length === 0) {
    console.error('the model produced no usable cards — check --model and the material');
    return 1;
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
  const { version } = await checkConnection(args.ankiUrl);
  console.log(`AnkiConnect OK (${args.ankiUrl}, protocol v${version})`);
  if (!args.apiKey) console.log('OPENAI_API_KEY not set — generation will fail until it is');
  if (!args.model) console.log('no model configured — pass --model or set OPENAI_MODEL');
  return 0;
}

const HELP = `anki-forge — turn textbooks and lecture notes into Anki decks, with your own LLM key.

  anki-forge import <file...> --deck <name> [options]
  anki-forge check

Import options:
  --deck <name>            target deck, "::" nests ("Med::Cardio")   required
  --dry-run                generate and preview, write nothing
  --max-cards-per-chunk N  cap per section (default 10)
  --language LANG          force card language, default follows the material
  --tags a,b               extra tags on every card
Generation (any OpenAI-compatible endpoint):
  --base-url URL           default $OPENAI_BASE_URL or https://api.openai.com/v1
  --model NAME             default $OPENAI_MODEL (required)
  --api-key KEY            default $OPENAI_API_KEY                    required
Anki:
  --anki-url URL           default $ANKI_CONNECT_URL or http://127.0.0.1:8765
                           (requires Anki desktop running with the AnkiConnect add-on)
`;

export async function main(argv = process.argv.slice(2), env = process.env) {
  let args;
  try {
    args = parseArgs(argv, env);
  } catch (e) {
    console.error(`error: ${e.message}`);
    return 2;
  }
  if (!args.command || args.command === 'help') {
    console.log(HELP);
    return args.command ? 0 : 2;
  }
  try {
    return args.command === 'check' ? await runCheck(args) : await runImport(args);
  } catch (e) {
    console.error(`error: ${e.message}`);
    return 2;
  }
}

const isMain = process.argv[1] && (await import('node:url')).pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) process.exit(await main());
