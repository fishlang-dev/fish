// `fishc layout`: a type named in a program, laid out as codegen lays it out.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { CompileError } from "../../src/diag.fsh";
import { formatLayouts, layoutsOf, type Layout } from "../../src/typelayout.fsh";
import { removed, scratch } from "./support.fsh";

const PROGRAM = `type Shape = { kind: "circle"; r: f64 } | { kind: "rect"; w: f64; h: f64; tag: u8 };
interface Area { area(): f64 }
class Point { x: f64; y: u8; z: i64; constructor() { this.x = 1; this.y = 2; this.z = 3; } }
class Box<T> { v: T; constructor(v: T) { this.v = v; } }
function main() {
  const s: Shape = { kind: "circle", r: 1 };
  const p = new Point();
  const b = new Box<i64>(1);
  const c = new Box<string>("a");
  console.log(p.x, b.v, c.v, s.kind);
}
`;

// The layouts `named` gives in PROGRAM, or the message of the error it raises, a compile error
// prefixed `compile: `.
function laidOut(named: string): Layout[] | string {
  const dir = scratch("fish-layout-");
  const file = join(dir, "main.fsh");
  try {
    writeFileSync(file, PROGRAM);
    return layoutsOf(file, PROGRAM, named);
  } catch (e) {
    return e instanceof CompileError ? `compile: ${e.message}` : (e as { message: string }).message;
  } finally {
    removed(dir);
  }
}

function layouts(named: string): Layout[] {
  const got = laidOut(named);
  if (typeof got === "string") {
    assert(false, `${named}: ${got}`);
    return [];
  }
  return got;
}

test("a class's fields at their offsets, with the padding between them", () => {
  const ps = layouts("Point");
  const p: Ref<Layout> = ps[0]!;
  assert(p.llvm === '%"<Point>"' && p.body === "{ double, i8, i64 }", `${p.llvm} = ${p.body}`);
  assert(p.size === 24 && p.align === 8, `${p.size} ${p.align}`);
  const parts = p.parts.map((f) => `${f.name}@${f.offset}:${f.size}`).join(" ");
  assert(parts === "x@0:8 y@8:1 z@16:8", parts);
  const text = formatLayouts(ps);
  assert(text.includes("7 bytes of padding") && text.includes("(padding)"), text);
});

test("a union's tag, payload words and members", () => {
  const us = layouts("Shape");
  const u: Ref<Layout> = us[0]!;
  assert(u.union !== undefined, "no union");
  assert(u.body === "{ i32, [3 x i64] }" && u.llvm.startsWith('%"<u.'), `${u.llvm} = ${u.body}`);
  assert(u.size === 32 && u.union!.words === 3 && u.union!.members.length === 2, `${u.size} ${u.union!.words}`);
  const words = u.union!.members.map((m) => `${m.tag}:${m.words}`).toSorted().join(" ");
  assert(words === "0:1 1:3" || words === "0:3 1:1", words);
});

test("a generic instance, and every instance of a generic class named alone", () => {
  const bs = layouts("Box<string>");
  const b: Ref<Layout> = bs[0]!;
  assert(b.llvm === '%"<Box<string>>"' && b.parts.length === 1 && b.parts[0]!.llvm === "ptr", `${b.llvm} ${b.body}`);
  const all = layouts("Box").map((l) => `${l.name} ${l.body}`).join(", ");
  assert(all === "Box<i64> { i64 }, Box<string> { ptr }", all);
});

test("an interface, and a name the program doesn't have", () => {
  const area = laidOut("Area");
  assert(typeof area === "string" && area.startsWith("compile: ") && area.includes("Dyn<Area>"), "Area isn't refused as an interface");
  const nope = laidOut("Nope");
  assert(typeof nope === "string" && nope.startsWith("compile: ") && nope.includes("Nope"), "Nope isn't refused");
});
