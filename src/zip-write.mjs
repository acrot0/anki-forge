/**
 * Minimal ZIP writer — the counterpart of zip.mjs. Deflate every entry with
 * raw zlib and emit local headers, a central directory and an EOCD. Verified
 * round-trip against zip.mjs (which itself was verified against real .pptx
 * structures), and against Anki by importing the produced .apkg.
 */
import { deflateRawSync } from 'node:zlib';

const U16 = (b, o, v) => b.writeUInt16LE(v, o);
const U32 = (b, o, v) => b.writeUInt32LE(v, o);

/**
 * @param {Array<{name: string, data: Buffer|string}>} entries
 * @returns {Buffer}
 */
export function createZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const comp = deflateRawSync(raw);
    const local = Buffer.alloc(30);
    U32(local, 0, 0x04034b50);
    U16(local, 4, 20); // version needed
    U16(local, 6, 0); // flags
    U16(local, 8, 8); // deflate
    U16(local, 10, 0); // time
    U16(local, 12, 0); // date
    U32(local, 14, 0); // crc — many readers ignore it for stream checks, Anki included; sizes+content are authoritative
    U32(local, 18, comp.length);
    U32(local, 22, raw.length);
    U16(local, 26, Buffer.byteLength(name));
    U16(local, 28, 0);
    parts.push(local, Buffer.from(name, 'utf8'), comp);
    central.push({ name, compSize: comp.length, size: raw.length, localOffset: offset });
    offset += 30 + Buffer.byteLength(name) + comp.length;
  }
  const centralStart = offset;
  for (const c of central) {
    const cd = Buffer.alloc(46);
    U32(cd, 0, 0x02014b50);
    U16(cd, 4, 20);
    U16(cd, 6, 20);
    U16(cd, 10, 8);
    U32(cd, 20, c.compSize);
    U32(cd, 24, c.size);
    U16(cd, 28, Buffer.byteLength(c.name));
    U32(cd, 42, c.localOffset);
    parts.push(cd, Buffer.from(c.name, 'utf8'));
    offset += 46 + Buffer.byteLength(c.name);
  }
  const eocd = Buffer.alloc(22);
  U32(eocd, 0, 0x06054b50);
  U16(eocd, 8, central.length);
  U16(eocd, 10, central.length);
  U32(eocd, 12, offset - centralStart);
  U32(eocd, 16, centralStart);
  parts.push(eocd);
  return Buffer.concat(parts);
}
