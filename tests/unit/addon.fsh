// `fishc build --addon`: the declarations and wrappers generated for a file's exports, in process,
// and an addon built by the native fishc. Loading one takes Node or Bun, which no test runs; the
// declarations are what a JavaScript caller sees, so they are what is checked here.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addonOf, type Addon } from "../../src/addon.fsh";
import { fishc, removed, same, scratch } from "./support.fsh";

const SAMPLE = `export type Point = { x: f64; y: f64 };
interface Tagged { name: string; score?: i32; tags: string[] }
export function add(a: i64, b: i64): i64 {
  return a + b;
}
export function mid(p: Point, q: Point): Point {
  return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
}
export function first(xs: string[]): string | null {
  return xs.length > 0 ? xs[0] : null;
}
export function tagged(t: Tagged): Tagged {
  return t;
}
export function bytes(b: u8[]): u8[] {
  return b;
}
export function big(n: bigint): bigint {
  return n;
}
export function fail(message: string): void throws Error {
  throw new Error(message);
}
export async function later(n: i64): Promise<Point> {
  return { x: n as f64, y: 0 };
}
function hidden(): void {}
`;

function sampleAddon(): Addon {
  try {
    return addonOf(SAMPLE, "./sample.fsh");
  } catch (e) {
    assert(false, `the sample: ${e.message}`);
    return { fish: "", glue: "", dts: "" };
  }
}

test("an addon's .d.ts declares each export as JavaScript sees it", () => {
  const made = sampleAddon();
  same(made.dts, `export declare function add(a: number, b: number): number;
export declare function mid(p: { x: number; y: number }, q: { x: number; y: number }): { x: number; y: number };
export declare function first(xs: (string)[]): string | null;
export declare function tagged(t: { name: string; score?: number; tags: (string)[] }): { name: string; score?: number; tags: (string)[] };
export declare function bytes(b: Uint8Array): Uint8Array;
export declare function big(n: bigint): bigint;
export declare function fail(message: string): void;
export declare function later(n: number): Promise<{ x: number; y: number }>;
`, "the declarations");
  assert(made.fish.startsWith(`import { add, mid, first, tagged, bytes, big, fail, later } from "./sample.fsh";`), "the generated entry imports every export");
  assert(made.glue.includes(`napi_create_function(env, "later", 5, fishaddon_later, NULL, &fn);`), "the glue registers each export under its own name");
});

function refusal(src: string): string {
  try {
    addonOf(src, "./x.fsh");
  } catch (e) {
    return e.message;
  }
  return "";
}

test("what can't cross to JavaScript is refused, naming why", () => {
  same(refusal(`export function f(x: [i64, i64]): void {}`), "an addon can't pass a tuple to JavaScript; use an object type", "a tuple");
  same(refusal(`export function f(x: i64 | string): void {}`), "an addon can't pass this union to JavaScript; only 'T | null' and 'T | undefined' cross", "a union");
  same(refusal(`export function f(x: Missing): void {}`), "an addon can't pass 'Missing' to JavaScript; it isn't a type this file declares; declare it here with 'type Missing = ...'", "an unknown name");
  same(refusal(`type Tree = { kids: Tree[] };\nexport function f(t: Tree): void {}`), "an addon can't pass 'Tree' to JavaScript; it holds itself, which a JavaScript value can't", "a type holding itself");
  same(refusal(`export function f<T>(x: T): void {}`), "an addon can't export a generic function, which JavaScript calls with no types; export one for each type", "a generic");
  same(refusal(`export function f(x: i64) {}`), "'f' needs its return type written to be exported to JavaScript, 'void' if it returns nothing", "no return type");
  same(refusal(`export async function f(): Promise<u8[]> { return []; }`), "an async export's result crosses back to JavaScript as JSON, which has no bigint or bytes; give it as a string", "bytes from an async export");
  same(refusal(`function f(): void {}`), "an addon has nothing for JavaScript to call; mark functions with 'export'", "no exports");
});

test("fishc build --addon writes the .node and its .d.ts", () => {
  const root = scratch("fish-addon-");
  try {
    builds(root);
  } catch (e) {
    assert(false, `the addon's files: ${e.message}`);
  }
  removed(root);
}, { timeout: 120_000 });

/** @throws {IoError} */
function builds(root: string): void {
  writeFileSync(join(root, "sample.fsh"), SAMPLE);
  const built = fishc(root, ["build", "--addon", "sample.fsh"]);
  same(`${built.code} ${built.err}`, "0 ", "the build");
  assert(existsSync(join(root, "sample.node")), "no sample.node");
  same(readFileSync(join(root, "sample.d.ts"), "utf8"), sampleAddon().dts, "the .d.ts beside it");
  const named = fishc(root, ["build", "--addon", "sample.fsh", "-o", "out/lib.node"]);
  assert(named.code === 1 && named.err.length > 0, "a missing output directory is an error");
  writeFileSync(join(root, "bad.fsh"), `export function f(x: [i64, i64]): void {}\n`);
  const refused = fishc(root, ["build", "--addon", "bad.fsh"]);
  assert(refused.code === 1 && refused.err.includes("bad.fsh:1:22: error[E1003]: an addon can't pass a tuple to JavaScript"), `the refusal: ${refused.err}`);
}
