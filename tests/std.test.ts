import { expect, test } from "bun:test";
import { newCompilation } from "../src/compilation.ts";
import { cachedSession } from "../src/stdcache.ts";
import { parse } from "../src/parser.ts";
import { stdFor } from "../src/std.ts";

const session = cachedSession();

// The classes and functions std gives a program, by name: a program's own name for one of std's
// leaves std's under a name no program can write, or leaves out the library it would clash with.
const given = (src: string) => {
  const compilation = newCompilation(session);
  return stdFor(compilation, parse(src, compilation.ids)).flatMap((s) => (s.kind === "class" || s.kind === "function" ? [s.name] : []));
};

const SERVE = `async function main(): Promise<void> throws IoError { await serve({}, async (req) => new Response("hi")); }`;

test("a program's own TypeError, bound by let, const or a pattern, hides std's", () => {
  for (const own of ["let TypeError = 5;", "const TypeError = 5;", "const { a: TypeError } = { a: 1 };", "const [, [TypeError]] = [1, [2]];", "export const { b = 2, ...TypeError } = { a: 1 };"]) {
    for (const program of [own, `${own}\n${SERVE}`]) {
      const names = given(program);
      expect(names).toContain("std TypeError");
      expect(names).not.toContain("TypeError");
    }
  }
});

test("a program's own URL, bound by let, const or a pattern, hides std's", () => {
  for (const own of ["let URL = 5;", "const URL = 5;", "const [URL] = [1];", "export const { u: URL } = { u: 1 };"]) {
    for (const program of [`${own}\nconst p = new URLSearchParams("a=1");`, `${own}\nconst p = new URLSearchParams("a=1");\n${SERVE}`]) {
      const names = given(program);
      expect(names).toContain("std URL");
      expect(names).toContain("URLSearchParams");
      expect(names).not.toContain("URL");
    }
  }
});

test("a program's own fetch, bound by let, const or a pattern, leaves std's out and keeps serve", () => {
  for (const own of ["let fetch = 5;", "const fetch = 5;", "const { f: { fetch } } = { f: { fetch: 1 } };", "export const [fetch] = [1];"]) {
    expect(given(`${own}\nconst x = fetch;\n${SERVE}`)).toEqual(expect.arrayContaining(["serve"]));
    expect(given(`${own}\nconst x = fetch;\n${SERVE}`)).not.toContain("fetch");
    expect(given(`${own}\nconst x = fetch;`)).not.toContain("serve");
  }
  expect(given(`const x = fetch;\n${SERVE}`)).toEqual(expect.arrayContaining(["serve", "fetch"]));
});
