import { createHash } from "node:crypto";

// Which Unicode version this JavaScript engine's data is, as a hash of the code points it
// counts as assigned: each version assigns more, so two engines agree on it only on the same
// version. Taken from the data itself, since an engine may report one version and use the
// operating system's ICU, as Bun does on macOS.
export function unicodeFingerprint(): string {
  const assigned = /\P{Cn}/u;
  const ranges: [number, number][] = [];
  for (let cp = 0; cp <= 0x10ffff; cp++) {
    if (!assigned.test(String.fromCodePoint(cp))) continue;
    const last = ranges.at(-1);
    if (last && last[1] === cp - 1) last[1] = cp;
    else ranges.push([cp, cp]);
  }
  return createHash("sha256").update(JSON.stringify(ranges)).digest("hex").slice(0, 16);
}
