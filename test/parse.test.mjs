import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, parseText, parsePdfText } from '../src/parse.mjs';

describe('parseMarkdown', () => {
  test('splits on headings and carries the title', () => {
    const para1 = 'The heart pumps blood through the circulatory system. '.repeat(8);
    const para2 = 'Four valves keep the blood moving in one direction only. '.repeat(8);
    const chunks = parseMarkdown(['# Heart', para1, '## Valves', para2].join('\n'));
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].title, 'Heart');
    assert.ok(chunks[0].text.startsWith('The heart pumps'));
    assert.equal(chunks[1].title, 'Valves');
  });

  test('splits oversized heading sections by size', () => {
    const para = 'x'.repeat(80);
    const text = `# Big\n${Array(50).fill(para).join('\n')}`;
    const chunks = parseMarkdown(text, { maxChars: 1000 });
    assert.ok(chunks.length > 1, 'expected the long section to be split');
    for (const c of chunks) assert.ok(c.text.length <= 1100, `chunk too big: ${c.text.length}`);
  });

  test('merges undersized sections instead of emitting fragments', () => {
    const text = '# A\none\n# B\ntwo\n# C\nthree';
    const chunks = parseMarkdown(text, { maxChars: 3000 });
    assert.equal(chunks.length, 1);
  });
});

describe('parseText', () => {
  test('accumulates paragraphs up to maxChars without titles', () => {
    const para = 'word '.repeat(100);
    const chunks = parseText(`${para}\n\n${para}\n\n${para}`, { maxChars: 400 });
    assert.ok(chunks.length >= 2);
    assert.ok(chunks.every((c) => c.title === null || c.title === ''));
  });
});

describe('parsePdfText', () => {
  test('treats short punctuation-free lines as headings', () => {
    const chunks = parsePdfText(['Chapter 3 Thermodynamics', 'Entropy never decreases in an isolated system. This is the second law.'].join('\n'));
    assert.equal(chunks[0].title, 'Chapter 3 Thermodynamics');
  });

  test('does not treat sentences as headings', () => {
    const chunks = parsePdfText(['This line ends with a period.', 'More prose follows here.'].join('\n'));
    assert.ok(chunks.every((c) => !c.title));
  });

  test('ignores list items and numbered lines as headings', () => {
    const chunks = parsePdfText(['- bullet point item', '1. numbered entry here', 'Prose line below them.'].join('\n'));
    assert.ok(chunks.every((c) => !c.title));
  });
});
