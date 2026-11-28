// The files comptime may read: those a package's `fish.toml` lists under `[comptime] reads`, as
// globs relative to the package's directory. Each matching file is part of what a check and a
// script's build are keyed by, so changing one rebuilds what read it.
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

// A package's directory, by its real path, and the globs its manifest lets comptime read.
export type Reads = { dir: string; globs: string[] };

// Whether one name matches one glob segment: `*` any run of characters, `?` one, and everything
// else itself.
function nameMatches(glob: string, name: string): boolean {
  // Where a `*` last was, and the name's position it matched up to, to try it on one more.
  let g: i64 = 0;
  let n: i64 = 0;
  let star: i64 = -1;
  let after: i64 = 0;
  const gl = glob.length as i64;
  const nl = name.length as i64;
  while (n < nl) {
    if (g < gl && (glob.charAt(g) === "?" || glob.charAt(g) === name.charAt(n))) {
      g++;
      n++;
    } else if (g < gl && glob.charAt(g) === "*") {
      star = g;
      after = n;
      g++;
    } else if (star >= 0) {
      g = star + 1;
      after++;
      n = after;
    } else return false;
  }
  while (g < gl && glob.charAt(g) === "*") g++;
  return g === gl;
}

// Whether a `/`-separated path matches a glob: a `**` segment stands for any run of directories,
// none included.
export function globMatches(glob: string, path: string): boolean {
  return segmentsMatch(glob.split("/"), 0, path.split("/"), 0);
}

function segmentsMatch(globs: Ref<string[]>, g: usize, names: Ref<string[]>, n: usize): boolean {
  if (g === globs.length) return n === names.length;
  if (globs[g]! === "**") {
    for (let at = n; at <= names.length; at++) if (segmentsMatch(globs, g + 1, names, at)) return true;
    return false;
  }
  return n < names.length && nameMatches(globs[g]!, names[n]!) && segmentsMatch(globs, g + 1, names, n + 1);
}

// Whether a package-relative, `/`-separated path is one the globs list.
export function listed(globs: Ref<string[]>, path: string): boolean {
  for (const g of globs) if (globMatches(g, path)) return true;
  return false;
}

// The package-relative path `written` names when comptime may read it, or why it may not: a path
// outside the package, absolute, or one no glob lists.
export function readable(reads: Ref<Reads>, written: string): { path: string } | { why: string } {
  if (written === "" || written.startsWith("/") || /^[A-Za-z]:/.test(written)) return { why: `'${written}' isn't a path inside the package; name it relative to the directory holding fish.toml` };
  const full = resolve(reads.dir, written);
  const inside = relative(reads.dir, full);
  if (inside === "" || inside.startsWith("..") || inside.startsWith(sep)) return { why: `'${written}' is outside the package; comptime reads only the package's own files` };
  const path = inside.split(sep).join("/");
  if (!listed(reads.globs, path)) return { why: `'${path}' isn't listed under [comptime] reads in fish.toml; add a glob that matches it, as in reads = ["${path}"]` };
  if (!existsSync(full)) return { why: `'${path}' doesn't exist` };
  // A link out of the package would read what the globs never named.
  try {
    const real = relative(reads.dir, realpathSync(full));
    if (real.startsWith("..") || real.startsWith(sep)) return { why: `'${path}' links outside the package; comptime reads only the package's own files` };
  } catch (_e) {
    return { why: `'${path}' can't be read` };
  }
  return { path: full };
}

// Every file the globs list, by its absolute path, in order. Hidden directories and `target`, where
// builds go, aren't searched.
export function listedFiles(reads: Ref<Reads>): string[] {
  let out: string[] = [];
  let pending: string[] = [""];
  while (pending.length > 0) {
    const at = pending.shift()!;
    let names: string[] = [];
    try {
      names = readdirSync(join(reads.dir, at));
    } catch (_e) {
      continue;
    }
    for (const name of names) {
      const path = at === "" ? name : `${at}/${name}`;
      let directory = false;
      try {
        directory = statSync(join(reads.dir, path)).isDirectory();
      } catch (_e) {
        continue;
      }
      if (directory) {
        if (!name.startsWith(".") && !(at === "" && name === "target")) pending.push(path);
      } else if (listed(reads.globs, path)) out.push(join(reads.dir, path));
    }
  }
  out.sort();
  return out;
}
