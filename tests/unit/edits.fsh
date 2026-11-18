// What an edit to one file changed, as `fishc watch` decides whether rechecking bodies is enough.
import { classified, type Edit } from "../compiler/edits.fsh";

const FILE = `import { x } from "./x.fsh";

function f(n: i64): i64 {
  return n + 1;
}

class C {
  a: i64 = 1;
  m(): i64 {
    return this.a;
  }
}

function g(): void {}
`;

function shown(e: Ref<Edit>): string {
  return e.fallback !== undefined ? `fallback: ${e.fallback}` : `bodies ${e.bodies.join(",")} signatures ${e.signatures.join(",")}${e.methods ? " in a class" : ""}`;
}

function sees(after: string, want: string): void {
  const got = shown(classified(FILE, after));
  assert(got === want, `want ${want}, got ${got}`);
}

test("an unchanged file changes nothing", () => {
  sees(FILE, "bodies  signatures ");
});

test("a function's, a method's and an empty body's edits are body edits", () => {
  sees(FILE.replace("return n + 1;", "const k = 2;\n  return n + k;"), "bodies 0 signatures ");
  sees(FILE.replace("return this.a;", "return this.a * 2;"), "bodies 1 signatures  in a class");
  sees(FILE.replace("function g(): void {}", "function g(): void { console.log(1); }"), "bodies 2 signatures ");
});

test("a top-level function's signature edit names the function", () => {
  sees(FILE.replace("function f(n: i64): i64", "function f(n: i64, m = 0): i64"), "bodies  signatures f");
});

test("edits outside bodies and signatures fall back", () => {
  const outside = "fallback: something outside a function's signature or body changed";
  sees(FILE.replace("a: i64 = 1;", "a: i64 = 2;"), outside);
  sees(FILE.replace("./x.fsh", "./y.fsh"), outside);
  sees(FILE + "function h(): void {}\n", outside);
});

test("a body that declares a type or runs comptime falls back, as does one that doesn't parse", () => {
  const local = "fallback: a changed body declares a type, runs comptime or belongs to a decorated declaration";
  sees(FILE.replace("return n + 1;", "type T = i64;\n  return n + 1;"), local);
  sees(FILE.replace("return n + 1;", "return n + comptime fib(1);"), local);
  sees(FILE.replace("return n + 1;", "return n +;"), "fallback: the file doesn't parse");
});
