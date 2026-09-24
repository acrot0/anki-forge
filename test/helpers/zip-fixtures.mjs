import { deflateRawSync } from 'node:zlib';

/** Build a real ZIP byte-stream: deflate entries + central dir + EOCD. */
export function makeZip(entries) {
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
  eocd.writeUInt16LE(central.length, 8);
  eocd.writeUInt32LE(offset - centralStart, 12);
  eocd.writeUInt32LE(centralStart, 16);
  parts.push(eocd);
  return Buffer.concat(parts);
}
