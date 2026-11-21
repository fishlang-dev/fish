// Codegen names what it generates from what it stands for, so editing
// a program leaves the IR of std's functions, and of the constants and glue they use, exactly as
// it was.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bodyOf } from "../../src/arenas.fsh";
import { compiledOf } from "../../src/codegen.fsh";
import { analyze, compile } from "../../src/main.fsh";
import { STD_BASE } from "../../src/std.fsh";
import { cachedSession } from "../../src/stdcache.fsh";

function base(): string {
  return `class Point {
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
}

// The program `change` names: the base program changed that way.
function changed(change: string): string {
  const b = base();
  switch (change) {
    case "a changed string literal":
      return b.replace('"base"', '"changed text"').replace('"user "', '"/users/:id"');
    case "an added route":
      return b.replace("//EXTRA", 'app.get("/items/:n", async (req) => new Response("item " + req.param("n")));');
    case "a new class used with a std generic":
      return `class Thing {
  n: i64;
  constructor(n: i64) {
    this.n = n;
  }
}
${b.replace("//EXTRA", 'let m = new Map<string, Thing>();\n  m.set("a", new Thing(1));\n  console.log(m.size);')}`;
    case "a new Dyn of a user class":
      return `interface Shape {
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
${b.replace("//EXTRA", "const s: Dyn<Shape> = new Sq(2);\n  console.log(s.area());")}`;
    case "an added console.log of a new object type":
      return b.replace("//EXTRA", 'console.log({ a: 1, b: "x", c: [true] });');
  }
  assert(false, `no change named ${change}`);
  return b;
}

// How a symbol is written in the IR, with a quote or backslash in it escaped.
function quoted(name: string): string {
  return `"fsh.${name.replace(/["\\]/g, (c) => (c === '"' ? "\\22" : "\\5C"))}"`;
}

type Compiled = { ir: string; std: string[]; own: string[] };

// The program's IR, and the symbols of its functions whose bodies are std's and of those whose
// bodies are its own.
function compiled(src: string, file: string): Compiled {
  let out: Compiled = { ir: "", std: [], own: [] };
  try {
    writeFileSync(file, src);
    const checked = analyze(cachedSession(), src, file).checked;
    for (const i of compiledOf(checked)) {
      const b = bodyOf(checked.tables.arenas, i);
      if (b.foreign === true) continue;
      if (b.start >= STD_BASE) out.std.push(quoted(i.symbol));
      else out.own.push(quoted(i.symbol));
    }
    out.ir = compile(cachedSession(), src, file);
  } catch (e) {
    assert(false, `${file}: ${e.message}`);
  }
  return out;
}

// Each top-level definition in the IR by the symbol it defines.
function definitions(ir: string): Map<string, string> {
  let found = new Map<string, string>();
  const lines = ir.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("define ")) {
      const end = lines.indexOf("}", i as i64);
      const named = /@("[^"]*"|[\w.$-]+)\(/.exec(line);
      if (named !== null) found.set(named[1], lines.slice(i as i64, end + 1).join("\n"));
      i = end as usize;
    } else {
      const global = /^@("[^"]*"|[\w.$-]+) = /.exec(line);
      if (global !== null) found.set(global[1], line);
    }
    i++;
  }
  return found;
}

function references(text: string): string[] {
  let out: string[] = [];
  for (const m of text.matchAll(/@("[^"]*"|[\w.$-]+)/g)) out.push(m[1]);
  return out;
}

// Where two programs' IRs differ in std's functions, or in the constants and generated functions
// those reach that both define. The programs' own functions may differ.
function differences(a: string, b: string): string[] {
  let dir = "";
  try {
    dir = mkdtempSync(join(tmpdir(), "fish-stable-"));
  } catch (e) {
    assert(false, e.message);
  }
  const file = join(dir, "main.fsh");
  const x = compiled(a, file);
  const y = compiled(b, file);
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (_e) {}
  const left = definitions(x.ir);
  const right = definitions(y.ir);
  let std = new Set<string>();
  for (const s of x.std) std.add(s);
  for (const s of y.std) std.add(s);
  let roots: string[] = [];
  for (const s of std) if (left.has(s) && right.has(s)) roots.push(s);
  assert(roots.length > 100, `only ${roots.length} of std's functions in both`);
  let seen = new Set<string>();
  for (const s of roots) seen.add(s);
  for (const s of x.own) seen.add(s);
  for (const s of y.own) seen.add(s);
  let work = roots.clone();
  let found: string[] = [];
  while (work.length > 0) {
    const name = work.pop()!;
    const l = left.get(name);
    const r = right.get(name);
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
  return found.toSorted();
}

function unchangedBy(change: string): void {
  const found = differences(base(), changed(change));
  assert(found.length === 0, found.join("\n"));
}

test("std's IR is unchanged by a changed string literal", () => unchangedBy("a changed string literal"));
test("std's IR is unchanged by an added route", () => unchangedBy("an added route"));
test("std's IR is unchanged by a new class used with a std generic", () => unchangedBy("a new class used with a std generic"));
test("std's IR is unchanged by a new Dyn of a user class", () => unchangedBy("a new Dyn of a user class"));
test("std's IR is unchanged by an added console.log of a new object type", () => unchangedBy("an added console.log of a new object type"));
