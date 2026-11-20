// The files of a tar archive, in the ustar, pax and GNU forms `tar -czf` writes. Only plain files
// and directories are taken; anything else, and any path that would land outside where the
// archive is unpacked, is refused, so unpacking it can't write elsewhere.

export type TarFile = { path: string; data: Uint8Array };

// More entries than any package needs, so a flood of tiny files is refused.
export const MAX_ENTRIES = 10_000;

// `n` rounded up to whole 512-byte blocks.
const blocked = (n: usize): usize => n + 511 - ((n + 511) % 512);

// A header field's text, up to its first NUL.
function field(bytes: Ref<Uint8Array>, at: usize, length: usize): string {
  return new TextDecoder().decode(bytes.subarray(at, at + length)).replace(/\0.*$/s, "");
}

/** @throws {Error} */
function octalField(bytes: Ref<Uint8Array>, at: usize, length: usize): usize {
  const text = field(bytes, at, length).trim();
  if (!/^[0-7]*$/.test(text)) throw new Error("its archive has an entry of no readable size");
  return text === "" ? 0 : (parseInt(text, 8)! as usize);
}

/** @throws {Error} */
export function untar(bytes: Uint8Array, limit: usize): TarFile[] {
  let files: TarFile[] = [];
  let at: usize = 0;
  // What a pax or GNU long-name entry says of the entry after it.
  let nextPath: string | undefined = undefined;
  let nextSize: usize | undefined = undefined;
  let total: usize = 0;
  let entries = 0;
  while (at + 512 <= bytes.length) {
    if (bytes.subarray(at, at + 512).every((b) => b === 0)) break;
    entries++;
    if (entries > MAX_ENTRIES) throw new Error(`its archive holds more than ${MAX_ENTRIES} entries`);
    const size = nextSize ?? octalField(bytes, at + 124, 12);
    const written = field(bytes, at + 156, 1);
    const type = written !== "" ? written : "0";
    const prefix = field(bytes, at + 257, 6).startsWith("ustar") ? field(bytes, at + 345, 155) : "";
    const name = nextPath ?? (prefix !== "" ? `${prefix}/${field(bytes, at, 100)}` : field(bytes, at, 100));
    nextPath = undefined;
    nextSize = undefined;
    const data = bytes.subarray(at + 512, at + 512 + size);
    if (data.length !== size || !Number.isSafeInteger(size)) throw new Error("its archive ends partway through a file");
    at += 512 + blocked(size);
    if (type === "x") {
      const pax = paxRecords(data);
      nextPath = pax.path;
      nextSize = pax.size;
      continue;
    }
    if (type === "L") {
      // GNU's long name: the next entry's path, written as this entry's data.
      nextPath = new TextDecoder().decode(data).replace(/\0.*$/s, "");
      continue;
    }
    if (type === "g") continue;
    if (type !== "0" && type !== "5") throw new Error(`its archive holds '${name}', which isn't a plain file or directory`);
    const path = name.replace(/^\.\//, "").replace(/\/$/, "");
    if (path === "" || path === ".") continue;
    if (path.startsWith("/") || path.split("/").some((part) => part === ".." || part === "" || part === ".")) throw new Error(`its archive holds '${name}', a path that leads outside it`);
    if (type === "5") continue;
    total += size;
    if (total > limit) throw new Error(`its archive expands past ${limit / 1024 / 1024} MiB`);
    files.push({ path, data });
  }
  return files;
}

// A pax header's `path` and `size`, from its records, each `<length> <key>=<value>\n`, the
// length counting bytes.
/** @throws {Error} */
function paxRecords(records: Ref<Uint8Array>): { path?: string; size?: usize } {
  let found: { path?: string; size?: usize } = {};
  const unreadable = "its archive has a pax header it can't read";
  let at: usize = 0;
  while (at < records.length) {
    const space = records.indexOf(0x20, at as i64);
    if (space < 0) throw new Error(unreadable);
    const digits = new TextDecoder().decode(records.subarray(at, space as usize));
    if (!/^\d+$/.test(digits)) throw new Error(unreadable);
    const length = parseFloat(digits)! as usize;
    if (!Number.isSafeInteger(length) || length <= (space as usize) - at || at + length > records.length) throw new Error(unreadable);
    const record = new TextDecoder().decode(records.subarray((space as usize) + 1, at + length - 1));
    const equals = record.indexOf("=");
    const key = record.slice(0, equals);
    const value = record.slice(equals + 1);
    if (key === "path") found.path = value;
    if (key === "size") {
      if (!/^\d+$/.test(value)) throw new Error(unreadable);
      found.size = parseFloat(value)! as usize;
    }
    at += length;
  }
  return found;
}

// `n` in octal digits.
function octal(n: usize): string {
  if (n === 0) return "0";
  let out = "";
  for (let k = n; k > 0; k = (k - (k % 8)) / 8) out = String(k % 8) + out;
  return out;
}

function put(h: Mut<Uint8Array>, at: usize, value: string) {
  h.set(new TextEncoder().encode(value), at);
}

function header(name: string, size: usize, mode: usize, type: string): Uint8Array {
  let h = new Uint8Array(512);
  put(h, 0, name);
  put(h, 100, octal(mode).padStart(7, "0") + "\0");
  put(h, 108, octal(0).padStart(7, "0") + "\0");
  put(h, 116, octal(0).padStart(7, "0") + "\0");
  put(h, 124, octal(size).padStart(11, "0") + "\0");
  put(h, 136, octal(0).padStart(11, "0") + "\0");
  put(h, 148, "        ");
  put(h, 156, type);
  put(h, 257, "ustar\0");
  put(h, 263, "00");
  let sum: usize = 0;
  for (const b of h) sum += b as usize;
  put(h, 148, octal(sum).padStart(6, "0") + "\0 ");
  return h;
}

function padded(data: Ref<Uint8Array>): Uint8Array {
  let out = new Uint8Array(blocked(data.length));
  out.set(data);
  return out;
}

// A tar archive of `files` in ustar form, the same bytes for the same files: entries sorted, owner
// 0, times 0, and a pax header only for a path too long for the ustar fields.
export function tar(files: { path: string; data: Uint8Array; executable: boolean }[]): Uint8Array {
  let blocks: Uint8Array[] = [];
  const encoder = new TextEncoder();
  let sorted = [...files];
  sorted.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const f of sorted) {
    if (encoder.encode(f.path).length > 100) {
      // The record counts its own length's digits, so the length is found by trying until it holds.
      let length = encoder.encode(`0 path=${f.path}\n`).length;
      while (encoder.encode(`${length} path=${f.path}\n`).length !== length) length = encoder.encode(`${length} path=${f.path}\n`).length;
      const record = encoder.encode(`${length} path=${f.path}\n`);
      blocks.push(header("pax", record.length, 0o644, "x"));
      blocks.push(padded(record));
    }
    blocks.push(header(f.path.slice(0, 100), f.data.length, f.executable ? 0o755 : 0o644, "0"));
    blocks.push(padded(f.data));
  }
  blocks.push(new Uint8Array(1024));
  let size: usize = 0;
  for (const b of blocks) size += b.length;
  let out = new Uint8Array(size);
  let at: usize = 0;
  for (const b of blocks) {
    out.set(b, at);
    at += b.length;
  }
  return out;
}
