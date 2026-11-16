// What the ported tests share: reading files, which fails the test rather than throwing.
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The repository's root.
export function root(): string {
  return join(import.meta.dir, "..", "..");
}

export function read(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    assert(false, `can't read ${path}: ${e.message}`);
    return "";
  }
}

// Fails the test with both values shown when they differ.
export function same(got: string, want: string, what: string): void {
  assert(got === want, `${what}:\n--- expected\n${want}\n--- got\n${got}`);
}
