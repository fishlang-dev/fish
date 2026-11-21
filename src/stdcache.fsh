// What a compiler built by Fish compiles in place of stdcache.ts, whose cache stores std's tree in
// Bun's serialization format: each session parses std itself.
import { newSession } from "./compilation.fsh";
import { buildSession, type BuildSession } from "./mathlib.fsh";

export function cachedSession(): BuildSession {
  return buildSession(newSession());
}
