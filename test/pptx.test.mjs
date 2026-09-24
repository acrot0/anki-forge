import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { readZip } from '../src/zip.mjs';
import { parsePptx } from '../src/parse.mjs';

/** Build a real ZIP byte-stream: deflate entries + central dir + EOCD. */
function makeZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const comp = deflateRawSync(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, Buffer.from(name), comp);
    central.push({ name, compSize: comp.length, size: data.length, localOffset: offset });
    offset += 30 + name.length + comp.length;
  }
  const centralStart = offset;
  for (const c of central) {
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(c.compSize, 20);
    cd.writeUInt32LE(c.size, 24);
    cd.writeUInt16LE(c.name.length, 28);
    cd.writeUInt32LE(c.localOffset, 42);
    parts.push(cd, Buffer.from(c.name));
    offset += 46 + c.name.length;
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(centralStart, 16);
  parts.push(eocd);
  return Buffer.concat(parts);
}

const slideXml = (texts) =>
  `<?xml version="1.0"?><p:sx><p:txBody>${texts.map((t) => `<a:t>${t}</a:t>`).join('')}</p:txBody></p:sx>`;

describe('readZip', () => {
  test('reads deflated entries through the central directory', () => {
    const zip = makeZip([
      { name: 'a.xml', data: Buffer.from('<hello>world</hello>') },
      { name: 'ppt/slides/slide1.xml', data: Buffer.from('<a:t>one</a:t>') },
    ]);
    const entries = readZip(zip);
    assert.equal(entries.get('a.xml').toString(), '<hello>world</hello>');
    assert.equal(entries.get('ppt/slides/slide1.xml').toString(), '<a:t>one</a:t>');
  });

  test('rejects non-zip bytes with a named error', () => {
    assert.throws(() => readZip(Buffer.from('not a zip at all')), /no end-of-central-directory/);
  });
});

describe('parsePptx', () => {
  const pptx = makeZip([
    { name: '[Content_Types].xml', data: Buffer.from('<Types/>') },
    { name: 'ppt/slides/slide1.xml', data: Buffer.from(slideXml(['Chapter 1 Cells', 'A cell is the basic unit of life. Every living organism is made of cells, and each cell carries the machinery of life inside it.'])) },
    { name: 'ppt/slides/slide10.xml', data: Buffer.from(slideXml(['Summary', 'Ten is numerically after one. The summary slide recaps every chapter that came before it in the lecture deck.'])) },
    { name: 'ppt/slides/slide2.xml', data: Buffer.from(slideXml(['Chapter 2 DNA', 'DNA carries genetic information. The double helix stores the instructions required to build and maintain an organism.'])) },
  ]);

  test('orders slides numerically, not lexically (slide10 after slide2)', () => {
    const chunks = parsePptx(pptx);
    const titles = chunks.map((c) => c.title);
    assert.deepEqual(titles, ['Chapter 1 Cells', 'Chapter 2 DNA', 'Summary']);
  });

  test('slide text lands in chunk text, XML entities decoded', () => {
    const withEntity = makeZip([
      { name: 'ppt/slides/slide1.xml', data: Buffer.from(slideXml(['Title Here', 'A &amp; B &lt;tag&gt; plus filler text to pass the minimum length check.'])) },
    ]);
    const chunks = parsePptx(withEntity);
    assert.ok(chunks[0].text.includes('A & B <tag>'));
  });

  test('a zip with no slides reports the real problem', () => {
    assert.throws(() => parsePptx(makeZip([{ name: 'x.xml', data: Buffer.from('<x/>') }])), /no slides found/);
  });
});
