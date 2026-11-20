// The classes and functions std gives a program, by name. A program's own
// name for one of std's leaves std's under a name no program can write, or leaves out the library
// it would clash with.
import { newCompilation } from "../../src/compilation.fsh";
import { parse } from "../../src/parser.fsh";
import { cachedSession } from "../../src/stdcache.fsh";
import { stdFor } from "../../src/std.fsh";

function given(src: string): string[] {
  try {
    let compilation = newCompilation(cachedSession());
    const written = parse(src, compilation.ids);
    const all = stdFor(compilation, written);
    let names: string[] = [];
    for (const s of all) {
      if (s.kind === "function") names.push(s.name);
      else if (s.kind === "class") {
        // A class statement always has a name; only a class expression goes without.
        const name = s.name;
        if (name !== null) names.push(name);
      }
    }
    return names;
  } catch (e) {
    assert(false, `${JSON.stringify(src)}: ${e.message}`);
    return [];
  }
}

function serveProgram(): string {
  return `async function main(): Promise<void> throws IoError { await serve({}, async (req) => new Response("hi")); }`;
}

// Each problem with `names`: `has` missing from it or `lacks` in it.
function check(wrong: Mut<string[]>, program: string, names: Ref<string[]>, has: string[], lacks: string[]): void {
  for (const n of has) {
    if (!names.includes(n)) wrong.push(`${JSON.stringify(program)}: no ${n}`);
  }
  for (const n of lacks) {
    if (names.includes(n)) wrong.push(`${JSON.stringify(program)}: ${n} given`);
  }
}

test("a program's own TypeError, bound by let, const or a pattern, hides std's", () => {
  let wrong: string[] = [];
  for (const own of ["let TypeError = 5;", "const TypeError = 5;", "const { a: TypeError } = { a: 1 };", "const [, [TypeError]] = [1, [2]];", "export const { b = 2, ...TypeError } = { a: 1 };"]) {
    for (const program of [own, `${own}\n${serveProgram()}`]) {
      const names = given(program);
      check(wrong, program, names, ["std TypeError"], ["TypeError"]);
    }
  }
  assert(wrong.length === 0, wrong.join("\n"));
});

test("a program's own URL, bound by let, const or a pattern, hides std's", () => {
  let wrong: string[] = [];
  for (const own of ["let URL = 5;", "const URL = 5;", "const [URL] = [1];", "export const { u: URL } = { u: 1 };"]) {
    for (const program of [`${own}\nconst p = new URLSearchParams("a=1");`, `${own}\nconst p = new URLSearchParams("a=1");\n${serveProgram()}`]) {
      const names = given(program);
      check(wrong, program, names, ["std URL", "URLSearchParams"], ["URL"]);
    }
  }
  assert(wrong.length === 0, wrong.join("\n"));
});

test("a program's own fetch, bound by let, const or a pattern, leaves std's out and keeps serve", () => {
  let wrong: string[] = [];
  for (const own of ["let fetch = 5;", "const fetch = 5;", "const { f: { fetch } } = { f: { fetch: 1 } };", "export const [fetch] = [1];"]) {
    const served = `${own}\nconst x = fetch;\n${serveProgram()}`;
    check(wrong, served, given(served), ["serve"], ["fetch"]);
    const plain = `${own}\nconst x = fetch;`;
    check(wrong, plain, given(plain), [], ["serve"]);
  }
  const both = `const x = fetch;\n${serveProgram()}`;
  check(wrong, both, given(both), ["serve", "fetch"], []);
  assert(wrong.length === 0, wrong.join("\n"));
});
