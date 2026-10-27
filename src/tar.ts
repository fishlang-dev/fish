// The files of a tar archive, in the ustar, pax and GNU forms `tar -czf` writes. Only plain files
// and directories are taken; anything else, and any path that would land outside where the
// archive is unpacked, is refused, so unpacking it can't write elsewhere.

export type TarFile = { path: string; data: Uint8Array };

// More entries than any package needs, so a flood of tiny files is refused.
export const MAX_ENTRIES = 10_000;

export function untar(bytes: Uint8Array, limit: number): TarFile[] {
  const files: TarFile[] = [];
  const decode = (b: Uint8Array) => new TextDecoder().decode(b);
  const text = (at: number, length: number) => decode(bytes.subarray(at, at + length)).replace(/\0.*$/s, "");
  const octal = (at: number, length: number) => {
    const field = text(at, length).trim();
    if (!/^[0-7]*$/.test(field)) throw new Error("its archive has an entry of no readable size");
    return field === "" ? 0 : parseInt(field, 8);
  };
  let at = 0;
  let next: { path?: string; size?: number } = {};
  let total = 0;
  let entries = 0;
  while (at + 512 <= bytes.length) {
    if (bytes.subarray(at, at + 512).every((b) => b === 0)) break;
    if (++entries > MAX_ENTRIES) throw new Error(`its archive holds more than ${MAX_ENTRIES} entries`);
    const size = next.size ?? octal(at + 124, 12);
    const type = text(at + 156, 1) || "0";
    const prefix = text(at + 257, 6).startsWith("ustar") ? text(at + 345, 155) : "";
    const name = next.path ?? (prefix ? `${prefix}/${text(at, 100)}` : text(at, 100));
    next = {};
    const data = bytes.subarray(at + 512, at + 512 + size);
    if (data.length !== size || !Number.isSafeInteger(size)) throw new Error("its archive ends partway through a file");
    at += 512 + Math.ceil(size / 512) * 512;
    if (type === "x") {
      next = paxRecords(data);
      continue;
    }
    if (type === "L") {
      // GNU's long name: the next entry's path, written as this entry's data.
      next = { path: decode(data).replace(/\0.*$/s, "") };
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
function paxRecords(records: Uint8Array): { path?: string; size?: number } {
  const found: { path?: string; size?: number } = {};
  let at = 0;
  while (at < records.length) {
    const space = records.indexOf(0x20, at);
    const length = Number(new TextDecoder().decode(records.subarray(at, space)));
    if (space < 0 || !Number.isSafeInteger(length) || length <= space - at || at + length > records.length) throw new Error("its archive has a pax header it can't read");
    const record = new TextDecoder().decode(records.subarray(space + 1, at + length - 1));
    const equals = record.indexOf("=");
    const [key, value] = [record.slice(0, equals), record.slice(equals + 1)];
    if (key === "path") found.path = value;
    if (key === "size") {
      if (!/^\d+$/.test(value)) throw new Error("its archive has a pax header it can't read");
      found.size = Number(value);
    }
    at += length;
  }
  return found;
}

// A tar archive of `files` in ustar form, the same bytes for the same files: entries sorted, owner
// 0, times 0, and a pax header only for a path too long for the ustar fields.
export function tar(files: { path: string; data: Uint8Array; executable: boolean }[]): Uint8Array {
  const blocks: Uint8Array[] = [];
  const encoder = new TextEncoder();
  const header = (name: string, size: number, mode: number, type: string): Uint8Array => {
    const h = new Uint8Array(512);
    const put = (at: number, value: string) => h.set(encoder.encode(value), at);
    const octal = (at: number, length: number, n: number) => put(at, n.toString(8).padStart(length - 1, "0") + "\0");
    put(0, name);
    octal(100, 8, mode);
    octal(108, 8, 0);
    octal(116, 8, 0);
    octal(124, 12, size);
    octal(136, 12, 0);
    put(148, "        ");
    put(156, type);
    put(257, "ustar\0");
    put(263, "00");
    const sum = h.reduce((a, b) => a + b, 0);
    put(148, sum.toString(8).padStart(6, "0") + "\0 ");
    return h;
  };
  const padded = (data: Uint8Array) => {
    const out = new Uint8Array(Math.ceil(data.length / 512) * 512);
    out.set(data);
    return out;
  };
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    if (encoder.encode(f.path).length > 100) {
      const body = (n: number) => `${n} path=${f.path}\n`;
      let length = encoder.encode(body(0)).length;
      while (encoder.encode(body(length)).length !== length) length = encoder.encode(body(length)).length;
      const record = encoder.encode(body(length));
      blocks.push(header("pax", record.length, 0o644, "x"), padded(record));
    }
    blocks.push(header(f.path.slice(0, 100), f.data.length, f.executable ? 0o755 : 0o644, "0"), padded(f.data));
  }
  blocks.push(new Uint8Array(1024));
  const out = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0));
  let at = 0;
  for (const b of blocks) {
    out.set(b, at);
    at += b.length;
  }
  return out;
}
