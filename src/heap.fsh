import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

// `fishc heap diff`: what grew between two pprof heap profiles, as `--heap-profile` builds write
// them, by allocation site, the innermost frame of each sample.

// Live memory at one site: the frame's function and where in it the allocation was made.
export type SiteUse = { site: string; bytes: i64; objects: i64 };

type Reader = { data: u8[]; at: usize };

function varint(r: Mut<Reader>): i64 throws Error {
  let v: i64 = 0;
  let shift: i64 = 0;
  while (true) {
    if (r.at >= r.data.length || shift > 63) throw new Error("the profile ends in the middle of a number");
    const b = r.data[r.at];
    r.at++;
    v = v | (((b & 0x7F) as i64) << shift);
    if ((b & 0x80) === 0) return v;
    shift += 7;
  }
}

// Each field of a message: its number, and its number value or its bytes.
type Field = { number: i64; value: i64; bytes: u8[] };

function fields(data: Ref<u8[]>): Field[] throws Error {
  let r: Reader = { data: data.clone(), at: 0 };
  let out: Field[] = [];
  while (r.at < r.data.length) {
    const key = varint(r);
    const wire = key & 7;
    if (wire === 0) out.push({ number: key >> 3, value: varint(r), bytes: [] });
    else if (wire === 2) {
      const n = varint(r) as usize;
      if (r.at + n > r.data.length) throw new Error("the profile ends in the middle of a field");
      out.push({ number: key >> 3, value: 0, bytes: r.data.slice(r.at as i64, (r.at + n) as i64) });
      r.at += n;
    } else if (wire === 1) r.at += 8;
    else if (wire === 5) r.at += 4;
    else throw new Error("the profile isn't pprof's protobuf");
  }
  return out;
}

// A repeated number field, packed or one at a time.
function numbers(f: Ref<Field>): i64[] throws Error {
  if (f.bytes.length === 0) return [f.value];
  let r: Reader = { data: f.bytes.clone(), at: 0 };
  let out: i64[] = [];
  while (r.at < r.data.length) out.push(varint(r));
  return out;
}

// Live bytes and objects in a profile by the site each sample was allocated at.
export function liveBySite(data: Ref<u8[]>): Map<string, SiteUse> throws Error {
  let bytes: u8[] = data.clone();
  if (data.length >= 2 && data[0] === 0x1F && data[1] === 0x8B) {
    try {
      bytes = gunzipSync(data.clone());
    } catch (e) {
      throw new Error("the profile is gzipped but doesn't unzip: " + e.message);
    }
  }
  const top = fields(bytes);
  let strings: string[] = [];
  const text = new TextDecoder();
  for (const f of top) if (f.number === 6) strings.push(text.decode(f.bytes));
  const named = (i: i64): string => (i >= 0 && i < (strings.length as i64) ? strings[i as usize] : "");
  let types: string[] = [];
  let functions = new Map<i64, [string, string]>();
  let locations = new Map<i64, string>();
  for (const f of top) {
    if (f.number === 1) {
      for (const g of fields(f.bytes)) if (g.number === 1) types.push(named(g.value));
    } else if (f.number === 5) {
      let id: i64 = 0;
      let name = "";
      let file = "";
      for (const g of fields(f.bytes)) {
        if (g.number === 1) id = g.value;
        else if (g.number === 2) name = named(g.value);
        else if (g.number === 4) file = named(g.value);
      }
      functions.set(id, [name, file]);
    }
  }
  for (const f of top) {
    if (f.number !== 4) continue;
    let id: i64 = 0;
    let fn: i64 = 0;
    let line: i64 = 0;
    for (const g of fields(f.bytes)) {
      if (g.number === 1) id = g.value;
      else if (g.number === 4) {
        for (const h of fields(g.bytes)) {
          if (h.number === 1) fn = h.value;
          else if (h.number === 2) line = h.value;
        }
      }
    }
    const found = functions.get(fn);
    const name = found === null ? "?" : found[0];
    const file = found === null ? "" : found[1];
    locations.set(id, (file === "" ? "" : file + (line > 0 ? ":" + String(line) : "") + " ") + name);
  }
  const space = types.indexOf("inuse_space");
  const objects = types.indexOf("inuse_objects");
  if (space < 0 || objects < 0) throw new Error("the profile has no inuse_space and inuse_objects; is it a heap profile?");
  let out = new Map<string, SiteUse>();
  for (const f of top) {
    if (f.number !== 2) continue;
    let locs: i64[] = [];
    let values: i64[] = [];
    for (const g of fields(f.bytes)) {
      if (g.number === 1) for (const n of numbers(g)) locs.push(n);
      else if (g.number === 2) for (const n of numbers(g)) values.push(n);
    }
    if (values.length <= (space as usize) || values.length <= (objects as usize)) continue;
    const site = locs.length > 0 ? locations.get(locs[0]) ?? "?" : "<runtime>";
    const was = out.get(site);
    const b = values[space as usize] + (was === null ? 0 : was.bytes);
    const o = values[objects as usize] + (was === null ? 0 : was.objects);
    out.set(site, { site, bytes: b, objects: o });
  }
  return out;
}

function size(n: i64): string {
  const sign = n < 0 ? "-" : "+";
  const a = n < 0 ? -n : n;
  if (a >= 1048576) return sign + ((a as f64) / 1048576.0).toFixed(1) + " MiB";
  if (a >= 1024) return sign + ((a as f64) / 1024.0).toFixed(1) + " KiB";
  return sign + String(a) + " B";
}

// What grew from the profile before to the one after, largest growth first, sites that shrank
// last, as lines to print.
export function heapDiff(before: Ref<u8[]>, after: Ref<u8[]>): string[] throws Error {
  const a = liveBySite(before);
  const b = liveBySite(after);
  let rows: SiteUse[] = [];
  for (const [site, now] of b) {
    const was = a.get(site);
    rows.push({ site, bytes: now.bytes - (was === null ? 0 : was.bytes), objects: now.objects - (was === null ? 0 : was.objects) });
  }
  for (const [site, was] of a) if (!b.has(site)) rows.push({ site, bytes: -was.bytes, objects: -was.objects });
  let kept: SiteUse[] = [];
  let total: i64 = 0;
  let count: i64 = 0;
  for (const r of rows) {
    total += r.bytes;
    count += r.objects;
    if (r.bytes !== 0 || r.objects !== 0) kept.push(r.clone());
  }
  kept.sort((x, y) => (y.bytes > x.bytes ? 1 : y.bytes < x.bytes ? -1 : x.site < y.site ? -1 : x.site > y.site ? 1 : 0));
  let out = ["live memory " + size(total) + ", " + (count < 0 ? "" : "+") + String(count) + " objects"];
  for (const r of kept) out.push("  " + size(r.bytes).padStart(12) + "  " + ((r.objects < 0 ? "" : "+") + String(r.objects)).padStart(8) + "  " + r.site);
  return out;
}

export function heapDiffFiles(before: string, after: string): string[] throws Error | IoError {
  const a = readFileSync(before);
  const b = readFileSync(after);
  return heapDiff(a, b);
}
