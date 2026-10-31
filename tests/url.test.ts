import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
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

// The server reads a request's path and checks its Host with the parser's path and host rules
// alone. Fed the WPT slice's paths and hosts, plus the cases of a Host the parser refuses and of
// dot segments and backslashes, it answers as the whole parser does: each target's pathname, and
// 400 for each Host the parser can't read.
test("the server reads paths and hosts as the URL parser does", async () => {
  const cases = (JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "url", "urltestdata.json"), "utf8")) as unknown[]).filter((c): c is Case => typeof c === "object");
  const authority = /^[a-zA-Z][a-zA-Z0-9+.-]*:[/\\]*([^/\\?#]*)/;
  // A target goes on the request line, so it holds no space or line break, and starts with '/'.
  const targets = cases.flatMap((c) => [c.input.replace(authority, ""), c.pathname ?? ""]).map((t) => (t.startsWith("/") ? t : "/" + t));
  targets.push("/a/../b", "/a/%2e%2e/b", "/a/.%2E/b", "/a/./b", "/%2e/x", "/a\\b", "/a\\..\\b", "/admin/x");
  // The server refuses outright a Host with a space, control, '/', '?', '#', '@', ',' or '\', so
  // only the rest reach the parser's rules.
  const hosts = cases.flatMap((c) => [(authority.exec(c.input)?.[1] ?? "").split("@").pop() ?? "", c.host ?? ""]);
  hosts.push("h", "h:8080", "h:abc", "a^b", "[::1", "a%zz", "h:", ":80", "[::1]:99999", "1.2.3.256", "0x7f.1");
  const paths = [...new Set(targets.filter((t) => t.isWellFormed() && !/[\0\n\r ]/.test(t)))];
  const named = [...new Set(hosts.filter((h) => h.length > 0 && h.isWellFormed() && !/[\0-\x20\x7f/?#@,\\]/.test(h)))];
  expect([paths.length, named.length]).toEqual([384, 323]);

  const oracle = join(tmp, "oracle.fsh");
  writeFileSync(oracle, `import { readFileSync } from "node:fs";
type Corpus = { paths: string[]; hosts: string[] };
function main(): void throws IoError | JsonError {
  const c = JSON.parse<Corpus>(new TextDecoder().decode(readFileSync(process.argv[2])));
  for (const t of c.paths) {
    try {
      console.log("200", new URL("http://h" + t).pathname);
    } catch (e) {
      console.log("400");
    }
  }
  for (const h of c.hosts) console.log(URL.canParse("http://" + h + "/") ? "200 /" : "400");
}
`);
  const corpus = join(tmp, "corpus.json");
  writeFileSync(corpus, JSON.stringify({ paths, hosts: named }));
  const main = join(import.meta.dir, "..", "src", "main.ts");
  expect(Bun.spawnSync(["bun", main, "build", oracle, "-o", join(tmp, "oracle")]).stderr.toString()).toBe("");
  const want = Bun.spawnSync([join(tmp, "oracle"), corpus]).stdout.toString().split("\n").slice(0, paths.length + named.length);

  const server = join(tmp, "server.fsh");
  writeFileSync(server, `async function main(): Promise<void> throws IoError {
  await serve({ port: 0, hostname: "127.0.0.1", onListen: (info: ServeInfo) => { console.error(info.port); } }, async (req) => new Response(req.path));
}
`);
  // The server's program names nothing that brings the parser.
  expect(Bun.spawnSync(["bun", main, "build", server, "--emit-llvm"]).stdout.toString()).not.toContain('@"fsh.url parse"');
  expect(Bun.spawnSync(["bun", main, "build", server, "-o", join(tmp, "server")]).stderr.toString()).toBe("");
  const proc = Bun.spawn([join(tmp, "server")], { stderr: "pipe" });
  try {
    const reader = proc.stderr.getReader();
    let seen = "";
    while (!seen.includes("\n")) seen += new TextDecoder().decode((await reader.read()).value);
    const port = Number(seen.trim());
    const ask = (target: string, host: string) =>
      new Promise<string>((resolve, reject) => {
        let got = Buffer.alloc(0);
        const socket = connect(port, "127.0.0.1", () => socket.write(`GET ${target} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`));
        socket.on("data", (d: Buffer) => (got = Buffer.concat([got, d])));
        socket.on("error", reject);
        socket.on("close", () => {
          const text = got.toString();
          const status = text.slice(9, 12);
          resolve(status === "200" ? `200 ${text.slice(text.indexOf("\r\n\r\n") + 4)}` : status);
        });
      });
    const got: string[] = [];
    for (const t of paths) got.push(await ask(t, "h"));
    for (const h of named) got.push(await ask("/", h));
    const label = [...paths.map((t) => `path ${t}`), ...named.map((h) => `host ${h}`)];
    expect(got.map((g, i) => `${label[i]} => ${g}`)).toEqual(want.map((w, i) => `${label[i]} => ${w}`));
  } finally {
    proc.kill();
  }
}, 120_000);
