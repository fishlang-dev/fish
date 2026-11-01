import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bodyOf } from "../src/arenas.ts";
import { analyze, compile } from "../src/main.ts";
import { STD_BASE } from "../src/std.ts";
import { newSession } from "../src/compilation.ts";

const session = newSession();

// Codegen names what it generates from what it stands for, so editing a program leaves the IR
// of std's functions, and of the constants and glue they use, exactly as it was.

const BASE = `class Point {
  x: i64;
  constructor(x: i64) {
    this.x = x;
  }
}

async function main(): Promise<void> {
  let app = new Router();
  app.get("/users/:id", async (req) => new Response("user " + req.param("id")));
  const res = await app.handle(new Request("http://h/users/7"));
  const body = await res.text();
  console.log(res.status, body);
  const points = [new Point(1)];
  console.log("base", points.length);
  //EXTRA
}
`;

const PAIRS: Record<string, string> = {
  "a changed string literal": BASE.replace('"base"', '"changed text"').replace('"user "', '"/users/:id"'),
  "an added route": BASE.replace("//EXTRA", 'app.get("/items/:n", async (req) => new Response("item " + req.param("n")));'),
  "a new class used with a std generic": `class Thing {
  n: i64;
  constructor(n: i64) {
    this.n = n;
  }
}
${BASE.replace("//EXTRA", 'let m = new Map<string, Thing>();\n  m.set("a", new Thing(1));\n  console.log(m.size);')}`,
  "a new Dyn of a user class": `interface Shape {
  area(): i64;
}
class Sq {
  side: i64;
  constructor(side: i64) {
    this.side = side;
  }
  area(): i64 {
    return this.side * this.side;
  }
}
${BASE.replace("//EXTRA", "const s: Dyn<Shape> = new Sq(2);\n  console.log(s.area());")}`,
  "an added console.log of a new object type": BASE.replace("//EXTRA", 'console.log({ a: 1, b: "x", c: [true] });'),
};

const FILE = join(mkdtempSync(join(tmpdir(), "fish-stable-")), "main.fsh");

// The program's IR, and the symbols of its functions whose bodies are std's and of those whose
// bodies are its own.
function compiled(src: string): { ir: string; std: string[]; own: string[] } {
  writeFileSync(FILE, src);
  const instances = analyze(session, src, FILE).checked.instances.filter((i) => !bodyOf(i).foreign);
  const quoted = (name: string) => `"fsh.${name.replace(/["\\]/g, (c) => `\\${c.charCodeAt(0).toString(16).toUpperCase()}`)}"`;
  const symbols = (std: boolean) => instances.filter((i) => bodyOf(i).start >= STD_BASE === std).map((i) => quoted(i.symbol));
  return { ir: compile(session, src, FILE), std: symbols(true), own: symbols(false) };
}

// Each top-level definition in the IR by the symbol it defines.
function definitions(ir: string): Map<string, string> {
  const found = new Map<string, string>();
  const lines = ir.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("define ")) {
      const end = lines.indexOf("}", i);
      found.set(/@("[^"]*"|[\w.$-]+)\(/.exec(line)![1]!, lines.slice(i, end + 1).join("\n"));
      i = end;
    } else {
      const global = /^@("[^"]*"|[\w.$-]+) = /.exec(line);
      if (global) found.set(global[1]!, line);
    }
  }
  return found;
}

const references = (text: string) => [...text.matchAll(/@("[^"]*"|[\w.$-]+)/g)].map((m) => m[1]!);

// Where two programs' IRs differ in std's functions, or in the constants and generated functions
// those reach that both define. The programs' own functions may differ.
function differences(a: string, b: string): string[] {
  const [x, y] = [compiled(a), compiled(b)];
  const [left, right] = [definitions(x.ir), definitions(y.ir)];
  const std = new Set([...x.std, ...y.std]);
  const roots = [...std].filter((s) => left.has(s) && right.has(s));
  expect(roots.length).toBeGreaterThan(100);
  const seen = new Set([...roots, ...x.own, ...y.own]);
  const work = [...roots];
  const found: string[] = [];
  while (work.length > 0) {
    const name = work.pop()!;
    const [l, r] = [left.get(name), right.get(name)];
    // A name only one program defines is the program's own.
    if (l === undefined || r === undefined) continue;
    if (l !== r) found.push(name);
    for (const next of references(l)) {
      if (!seen.has(next)) {
        seen.add(next);
        work.push(next);
      }
    }
  }
  return found.sort();
}

for (const [change, changed] of Object.entries(PAIRS)) {
  test(`std's IR is unchanged by ${change}`, () => {
    expect(differences(BASE, changed)).toEqual([]);
  });
}
