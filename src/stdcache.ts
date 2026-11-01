import { deserialize, serialize } from "bun:jsc";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { newSession, type Session } from "./compilation.ts";
import { cacheDir, partial } from "./mathlib.ts";
import { renumber } from "./nodes.ts";
import { parse, type Stmt } from "./parser.ts";
import { STD_SOURCE } from "./std.ts";

// A hash of the std source, the compiler's own sources and Bun's version, which decides the
// serialization format, so no other parser's tree is ever loaded. Null when no compiler source
// can be read, as inside a single-file executable, since the hash couldn't tell parsers apart.
export function stdKey(source: string, dir: string): string | null {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".ts")).sort();
  } catch {
    return null;
  }
  if (files.length === 0) return null;
  const hash = createHash("sha256").update(Bun.version).update("\0").update(source);
  for (const f of files) hash.update("\0").update(f).update("\0").update(readFileSync(join(dir, f)));
  return hash.digest("hex").slice(0, 16);
}

// A session that loads std's parsed tree, serialized: kept in memory, else read from the cache,
// else parsed and written there, the session counting the parse. A cache that can't be read or
// written only costs the parse, and without a key the cache isn't touched at all.
export function cachedSession(): Session {
  const session = newSession();
  let key: string | null | undefined;
  let tree: { path: string | null; bytes: Uint8Array } | undefined;
  const bytes = (): Uint8Array => {
    if (key === undefined) key = stdKey(STD_SOURCE, import.meta.dir);
    const path = key === null ? null : join(cacheDir(), "std", `ast-${key}.bin`);
    if (tree !== undefined && tree.path === path) return tree.bytes;
    let bytes: Uint8Array | undefined;
    if (path !== null) {
      try {
        bytes = readFileSync(path);
        // A tree from before nodes had ids, or anything else, is made again.
        const cached = deserialize(bytes);
        if (!Array.isArray(cached) || typeof cached[0]?.id !== "number") bytes = undefined;
      } catch {
        bytes = undefined;
      }
    }
    if (bytes === undefined) {
      session.std.parses++;
      // Ids are each compilation's own, so the cached tree holds zeros.
      bytes = new Uint8Array(serialize(renumber("stmt", parse(STD_SOURCE, { last: 0 }), () => 0)));
      if (path !== null) {
        try {
          const temp = partial(path);
          writeFileSync(temp, bytes);
          renameSync(temp, path);
        } catch {}
      }
    }
    tree = { path, bytes };
    return bytes;
  };
  session.std.load = (): Stmt[] => deserialize(bytes());
  return session;
}
