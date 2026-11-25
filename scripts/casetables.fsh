// JavaScript's case mapping as recorded: the tables scripts/casemap.fsh writes src/casemap.fsh from,
// and the unit tests check it against. They are Bun's answer to the script below, recorded with the
// tests' other reference answers by scripts/references.fsh, which is where Bun is run.
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The mappings and properties as JavaScript has them: each simple mapping a pair, each special one
// its code point then what it maps to, and each property a list of inclusive ranges.
export type Tables = { upper: i64[][]; upperSpecial: i64[][]; lower: i64[][]; lowerSpecial: i64[][]; cased: i64[][]; ignorable: i64[][]; unicode: string };

// What is asked of Bun: every mapping that changes a code point, and the two properties.
export function caseScript(): string {
  return `function mapping(change) {
  const simple = [];
  const special = [];
  for (let cp = 0; cp <= 0x10ffff; cp++) {
    if (cp >= 0xd800 && cp < 0xe000) continue;
    const to = [...change(String.fromCodePoint(cp))].map((c) => c.codePointAt(0));
    if (to.length === 1 && to[0] === cp) continue;
    if (to.length > 3) throw new Error("U+" + cp.toString(16) + " maps to " + to.length + " code points; widen the special tables");
    if (to.length === 1) simple.push([cp, to[0]]);
    else special.push([cp, ...to]);
  }
  return [simple, special];
}
function ranges(property) {
  const found = [];
  for (let cp = 0; cp <= 0x10ffff; cp++) {
    if (cp >= 0xd800 && cp < 0xe000) continue;
    if (!property.test(String.fromCodePoint(cp))) continue;
    const last = found.at(-1);
    if (last && last[1] === cp - 1) last[1] = cp;
    else found.push([cp, cp]);
  }
  return found;
}
const [upper, upperSpecial] = mapping((s) => s.toUpperCase());
const [lower, lowerSpecial] = mapping((s) => s.toLowerCase());
console.log(JSON.stringify({ upper, upperSpecial, lower, lowerSpecial, cased: ranges(/\\p{Cased}/u), ignorable: ranges(/\\p{Case_Ignorable}/u), unicode: process.versions.unicode ?? "unknown" }));
`;
}


// The recorded tables, read from the answer kept under `root`'s tests.
export function recordedTables(root: string): Tables throws IoError | JsonError | Error {
  const file = join(root, "tests", "unit", "references", "casemap-tables.txt");
  for (const line of readFileSync(file, "utf8").split("\n")) if (line.startsWith('{"upper"')) return JSON.parse<Tables>(line);
  throw new Error(`${file} holds no tables; record them with 'fishc run scripts/references.fsh'`);
}
