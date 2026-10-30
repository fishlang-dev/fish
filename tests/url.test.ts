import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The std URL parser against the web-platform-tests URL data: a vendored slice of
// urltestdata.json, each case parsed by `new URL(input, base)` in one Fish program, which prints
// the case's parts or the TypeError's message.
const tmp = mkdtempSync(join(tmpdir(), "fish-url-"));

type Case = { input: string; base: string | null; failure?: boolean; href: string; origin?: string; protocol: string; username: string; password: string; host: string; hostname: string; port: string; pathname: string; search: string; hash: string };

// The WPT cases left out of the slice: their hosts need international domain name processing,
// which Fish refuses for now.
const IDNA: [string, string | null][] = [
  ["http://é@é", null],
  ["http://GOO​⁠﻿goo.com", "http://other.com/"],
  ["http://www.foo。bar.com", "http://other.com/"],
  ["http://a.b.c.xn--pokxncvks", null],
  ["http://10.0.0.xn--pokxncvks", null],
  ["http://a.b.c.XN--pokxncvks", null],
  ["http://a.b.c.Xn--pokxncvks", null],
  ["http://10.0.0.XN--pokxncvks", null],
  ["http://10.0.0.xN--pokxncvks", null],
  ["http://Ｇｏ.com", "http://other.com/"],
  ["http://你好你好", "http://other.com/"],
  ["https://faß.ExAmPlE/", null],
  ["http://０Ｘｃ０．０２５０．０１", "http://other.com/"],
  ["ftp://%e2%98%83", null],
  ["https://%e2%98%83", null],
  ["file://a­b/p", null],
  ["file://a%C2%ADb/p", null],
  ["file://loC\u{1d400}\u{1d40b}\u{1d407}\u{1d428}\u{1d42c}\u{1d42d}/usr/bin", null],
  ["file://xn--/p", null],
  ["https://a%C2%ADb/", null],
  ["https://xn--/", null],
];

const PROGRAM = `import { readFileSync } from "node:fs";
type Case = { input: string; base: string | null };
function main(): void throws IoError | JsonError {
  const cases = JSON.parse<Case[]>(new TextDecoder().decode(readFileSync(process.argv[2])));
  for (const c of cases) {
    try {
      const u = new URL(c.input, c.base);
      console.log(JSON.stringify([u.href, u.origin, u.protocol, u.username, u.password, u.host, u.hostname, u.port, u.pathname, u.search, u.hash]));
    } catch (e) {
      if (e instanceof TypeError) console.log("failure", JSON.stringify(e.message));
    }
  }
}
`;

// Each case's line of output, run through one build of the program.
function parsed(cases: { input: string; base: string | null }[]): string[] {
  const program = join(tmp, "main.fsh");
  const out = join(tmp, "main");
  writeFileSync(program, PROGRAM);
  const built = Bun.spawnSync(["bun", join(import.meta.dir, "..", "src", "main.ts"), "build", program, "-o", out]);
  expect(built.stderr.toString()).toBe("");
  const input = join(tmp, `cases-${cases.length}.json`);
  writeFileSync(input, JSON.stringify(cases));
  const run = Bun.spawnSync([out, input], { env: { ...process.env, FISH_LEAKS: "1" } });
  expect(run.stderr.toString()).toBe("");
  return run.stdout.toString().split("\n").slice(0, cases.length);
}

test("new URL parses the WPT slice as the URL Standard says", () => {
  const cases = (JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "url", "urltestdata.json"), "utf8")) as unknown[]).filter((c): c is Case => typeof c === "object");
  expect(cases.length).toBe(875);
  const lines = parsed(cases.map((c) => ({ input: c.input, base: c.base })));
  const got = cases.map((c, i) => {
    const line = lines[i] ?? "";
    if (c.failure) return { input: c.input, base: c.base, failure: line.startsWith("failure ") };
    if (line.startsWith("failure ")) return { input: c.input, base: c.base, failed: line };
    const [href, origin, protocol, username, password, host, hostname, port, pathname, search, hash] = JSON.parse(line) as string[];
    return { input: c.input, base: c.base, href, ...(c.origin !== undefined && { origin }), protocol, username, password, host, hostname, port, pathname, search, hash };
  });
  const want = cases.map((c) => (c.failure ? { input: c.input, base: c.base, failure: true } : { input: c.input, base: c.base, href: c.href, ...(c.origin !== undefined && { origin: c.origin }), protocol: c.protocol, username: c.username, password: c.password, host: c.host, hostname: c.hostname, port: c.port, pathname: c.pathname, search: c.search, hash: c.hash }));
  expect(got).toEqual(want);
});

test("a host needing international domain names is a TypeError saying so", () => {
  const lines = parsed(IDNA.map(([input, base]) => ({ input, base })));
  expect(lines).toEqual(IDNA.map(() => `failure "Invalid URL: international domain names aren't supported yet"`));
});

test("a long URL and query are read in linear time", () => {
  const program = join(tmp, "long.fsh");
  const out = join(tmp, "long");
  // 200k repeats: about 2.4 MB of href, under a second when building output is linear, and well
  // over ten when each character copies what came before.
  writeFileSync(program, `function main(): void throws TypeError {
  const n: usize = 200000;
  const u = new URL("http://h/" + "\\u00e9".repeat(n) + "?" + "a b".repeat(n) + "#" + "x".repeat(n));
  const p = new URLSearchParams("a=" + "%41".repeat(n) + "&b=c");
  console.log(u.href.length, u.pathname.length, p.get("a")!.length, p.toString().length);
}
`);
  const built = Bun.spawnSync(["bun", join(import.meta.dir, "..", "src", "main.ts"), "build", program, "-o", out]);
  expect(built.stderr.toString()).toBe("");
  const start = performance.now();
  const run = Bun.spawnSync([out]);
  const took = performance.now() - start;
  expect(run.stdout.toString()).toBe("2400011 1200001 200000 200006\n");
  expect(took).toBeLessThan(5000);
});
