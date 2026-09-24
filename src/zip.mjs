/**
 * Minimal ZIP reader — just enough for OOXML (pptx/docx/xlsx). Entries are
 * located via the central directory (not local headers) because PowerPoint
 * files may use data descriptors, where local header sizes are zero.
 * Deflate-9 entries and stored entries cover every OOXML writer we care about;
 * anything else reports a specific error instead of returning garbage text.
 */
import { inflateRawSync } from 'node:zlib';

const U16 = (b, o) => b.readUInt16LE(o);
const U32 = (b, o) => b.readUInt32LE(o);

function findEocd(buf) {
  // EOCD is at least 22 bytes; the comment may push it further back.
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (U32(buf, i) === 0x06054b50) return i;
  }
  throw new Error('not a ZIP/OOXML file (no end-of-central-directory)');
}

/** @returns {Map<string, Buffer>} entry name → decompressed content */
export function readZip(buf) {
  const eocd = findEocd(buf);
  const count = U16(buf, eocd + 10);
  let offset = U32(buf, eocd + 16); // central directory offset
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (U32(buf, offset) !== 0x02014b50) throw new Error('corrupt ZIP central directory');
    const method = U16(buf, offset + 10);
    const compSize = U32(buf, offset + 20);
    const nameLen = U16(buf, offset + 28);
    const extraLen = U16(buf, offset + 30);
    const commentLen = U16(buf, offset + 32);
    const localOffset = U32(buf, offset + 42);
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen);

    // Skip the local header to reach the data — its sizes may be zeroed.
    const localNameLen = U16(buf, localOffset + 26);
    const localExtraLen = U16(buf, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    entries.set(name, method === 0 ? raw : method === 8 ? inflateRawSync(raw) : (() => {
      throw new Error(`unsupported ZIP compression method ${method} for ${name}`);
    })());

    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}
