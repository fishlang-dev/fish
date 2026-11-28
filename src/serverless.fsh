// What `--target lambda` writes: the function's executable as `bootstrap` in a zip archive, as
// Lambda's provided runtimes take one. Stored, not deflated: the compiler has no deflate of its
// own, and Lambda takes either.

// CRC-32 over the reflected polynomial 0xEDB88320, as zip computes it.
export function crc32(data: Ref<u8[]>): u32 {
  let table: u32[] = [];
  for (let n: u32 = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) === 1 ? 0xedb88320 ^ (c >> 1) : c >> 1;
    table.push(c);
  }
  let crc: u32 = 0xffffffff;
  for (const b of data) crc = table[((crc ^ (b as u32)) & 255) as usize]! ^ (crc >> 8);
  return crc ^ 0xffffffff;
}

function put(out: Mut<u8[]>, n: u32, size: i64): void {
  let left = n;
  for (let i = 0; i < size; i++) {
    out.push((left & 255) as u8);
    left = left >> 8;
  }
}

// One file `name` holding `data`, executable by its owner and readable by all, as an archive.
// Its time is 1980-01-01, zip's first, so the same executable zips to the same bytes.
export function zipped(name: string, data: Ref<u8[]>): u8[] {
  const named = new TextEncoder().encode(name);
  const crc = crc32(data);
  const size = data.length as u32;
  let out: u8[] = [];
  put(out, 0x04034b50, 4);
  put(out, 10, 2);
  put(out, 0, 2);
  put(out, 0, 2);
  put(out, 0, 2);
  put(out, 33, 2);
  put(out, crc, 4);
  put(out, size, 4);
  put(out, size, 4);
  put(out, named.length as u32, 2);
  put(out, 0, 2);
  for (const b of named) out.push(b);
  for (const b of data) out.push(b);
  const central = out.length as u32;
  // Made by Unix (3), so the high half of the external attributes is the file's mode, 0100755.
  put(out, 0x02014b50, 4);
  put(out, 0x031e, 2);
  put(out, 10, 2);
  put(out, 0, 2);
  put(out, 0, 2);
  put(out, 0, 2);
  put(out, 33, 2);
  put(out, crc, 4);
  put(out, size, 4);
  put(out, size, 4);
  put(out, named.length as u32, 2);
  put(out, 0, 2);
  put(out, 0, 2);
  put(out, 0, 2);
  put(out, 0, 2);
  put(out, 0x81ed0000, 4);
  put(out, 0, 4);
  for (const b of named) out.push(b);
  const directory = (out.length as u32) - central;
  put(out, 0x06054b50, 4);
  put(out, 0, 2);
  put(out, 0, 2);
  put(out, 1, 2);
  put(out, 1, 2);
  put(out, directory, 4);
  put(out, central, 4);
  put(out, 0, 2);
  return out;
}
