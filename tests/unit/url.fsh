// Ports tests/url.test.ts: the std URL parser against the web-platform-tests URL data: a vendored
// slice of urltestdata.json, each case parsed by `new URL(input, base)` in one Fish program, which
// prints the case's parts or the TypeError's message.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { built, fishc, removed, root, same, scratch, text } from "./support.fsh";

type Case = { input: string; base: string | null; failure?: boolean; href?: string; origin?: string; protocol?: string; username?: string; password?: string; host?: string; hostname?: string; port?: string; pathname?: string; search?: string; hash?: string };
type Input = { input: string; base: string | null };

// The WPT cases left out of the slice: their hosts need international domain name processing,
// which Fish refuses for now.
function idna(): [string, string | null][] {
  return [
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
}

function program(): string {
  return `import { readFileSync } from "node:fs";
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
}

function write(path: string, contents: string): void {
  try {
    writeFileSync(path, contents);
  } catch (e) {
    assert(false, `can't write ${path}: ${e.message}`);
  }
}

// The vendored slice's cases, its leading comment left out.
function fixture(): Case[] {
  let cases: Case[] = [];
  try {
    const all = JSON.parse<Json>(readFileSync(join(root(), "tests", "fixtures", "url", "urltestdata.json"), "utf8"));
    if (Array.isArray(all)) {
      for (const x of all) {
        if (typeof x !== "string") {
          const c = JSON.parse<Case>(JSON.stringify(x));
          cases.push(c);
        }
      }
    }
  } catch (e) {
    assert(false, `can't read the WPT slice: ${e.message}`);
  }
  return cases;
}

// Each case's line of output, run through one build of the program.
function parsed(tmp: string, cases: Ref<Input[]>): string[] {
  const out = built(tmp, "main", program());
  const input = join(tmp, `cases-${cases.length}.json`);
  write(input, JSON.stringify(cases));
  const run = spawnSync("env", ["FISH_LEAKS=1", out, input]);
  same(text(run.stderr), "", "the program's stderr");
  return text(run.stdout).split("\n").slice(0, cases.length as i64);
}

// A case's parts as the test compares them: `failure` alone for a failing case, else each part,
// the origin only where the case gives one.
function parts(c: Ref<Case>, xs: Ref<string[]>): string {
  let out: string[] = [];
  for (let i: usize = 0; i < xs.length; i++) {
    if (i !== 1 || c.origin !== undefined) out.push(xs[i]);
  }
  return JSON.stringify(out);
}

test("new URL parses the WPT slice as the URL Standard says", () => {
  const tmp = scratch("fish-url-");
  const cases = fixture();
  assert(cases.length === 875, `the slice has ${cases.length} cases, not 875`);
  const inputs: Input[] = cases.map((c) => ({ input: c.input, base: c.base }));
  const lines = parsed(tmp, inputs);
  let wrong: string[] = [];
  for (let i: usize = 0; i < cases.length; i++) {
    const c: Ref<Case> = cases[i];
    const line = i < lines.length ? lines[i] : "";
    const failure = c.failure ?? false;
    const want = failure ? "failure" : parts(c, [c.href ?? "", c.origin ?? "", c.protocol ?? "", c.username ?? "", c.password ?? "", c.host ?? "", c.hostname ?? "", c.port ?? "", c.pathname ?? "", c.search ?? "", c.hash ?? ""]);
    let got = "";
    if (line.startsWith("failure ")) got = failure ? "failure" : line;
    else if (failure) got = `parsed: ${line}`;
    else {
      try {
        got = parts(c, JSON.parse<string[]>(line));
      } catch (e) {
        got = `unreadable: ${line}`;
      }
    }
    if (got !== want) wrong.push(`${JSON.stringify(c.input)} on ${JSON.stringify(c.base)}:\n  expected ${want}\n  got      ${got}`);
  }
  assert(wrong.length === 0, `${wrong.length} cases differ:\n${wrong.join("\n")}`);
  removed(tmp);
});

test("a host needing international domain names is a TypeError saying so", () => {
  const tmp = scratch("fish-url-");
  const inputs: Input[] = idna().map(([input, base]) => ({ input, base }));
  const lines = parsed(tmp, inputs);
  let wrong: string[] = [];
  for (let i: usize = 0; i < inputs.length; i++) {
    const line = i < lines.length ? lines[i] : "";
    if (line !== `failure "Invalid URL: international domain names aren't supported yet"`) wrong.push(`${JSON.stringify(inputs[i].input)}: ${line}`);
  }
  assert(wrong.length === 0, `cases not refused as needing international domain names:\n${wrong.join("\n")}`);
  removed(tmp);
});

test("a long URL and query are read in linear time", () => {
  const tmp = scratch("fish-url-");
  // 200k repeats: about 2.4 MB of href, under a second when building output is linear, and well
  // over ten when each character copies what came before.
  const out = built(tmp, "long", `function main(): void throws TypeError {
  const n: usize = 200000;
  const u = new URL("http://h/" + "\\u00e9".repeat(n) + "?" + "a b".repeat(n) + "#" + "x".repeat(n));
  const p = new URLSearchParams("a=" + "%41".repeat(n) + "&b=c");
  console.log(u.href.length, u.pathname.length, p.get("a")!.length, p.toString().length);
}
`);
  const start = performance.now();
  const run = spawnSync(out, []);
  const took = performance.now() - start;
  same(text(run.stdout), "2400011 1200001 200000 200006\n", "the lengths");
  assert(took < 5000, `took ${took} ms`);
  removed(tmp);
});

// Adds `x` to `xs` unless `seen` has it, keeping the first one's place.
function once(xs: Mut<string[]>, seen: Mut<Set<string>>, x: string): void {
  if (seen.has(x)) return;
  seen.add(x);
  xs.push(x);
}

// A client sending each target with Host `h`, then `/` with each host, each on a connection of its
// own, printing the status and, for a 200, the body.
function client(): string {
  return `import { readFileSync } from "node:fs";
type Corpus = { paths: string[]; hosts: string[] };
async function ask(port: i64, target: string, host: string): Promise<string> throws IoError | AbortError {
  const conn = await TcpStream.connect("127.0.0.1", port, AbortSignal.timeout(2000));
  await conn.write(new TextEncoder().encode("GET " + target + " HTTP/1.1\\r\\nHost: " + host + "\\r\\nConnection: close\\r\\n\\r\\n"), AbortSignal.timeout(2000));
  let got: u8[] = [];
  while (true) {
    const more = await conn.read(4096, AbortSignal.timeout(2000));
    if (more.length === 0) break;
    for (const b of more) got.push(b);
  }
  const text = new TextDecoder().decode(got);
  const status = text.slice(9, 12);
  if (status !== "200") return status;
  const at = text.indexOf("\\r\\n\\r\\n");
  return "200 " + text.slice((at + 4) as i64);
}
async function main(): Promise<void> throws IoError | AbortError | JsonError {
  const c = JSON.parse<Corpus>(new TextDecoder().decode(readFileSync(process.argv[2])));
  const port = parseInt(process.argv[3]) ?? 0;
  for (const t of c.paths) {
    const got = await ask(port, t, "h");
    console.log(got);
  }
  for (const h of c.hosts) {
    const got = await ask(port, "/", h);
    console.log(got);
  }
}
`;
}

// The server reads a request's path and checks its Host with the parser's path and host rules
// alone. Fed the WPT slice's paths and hosts, plus the cases of a Host the parser refuses and of
// dot segments and backslashes, it answers as the whole parser does: each target's pathname, and
// 400 for each Host the parser can't read. The server runs in the background under `sh`, its port
// read from its stderr, and a Fish client sends the requests.
test("the server reads paths and hosts as the URL parser does", () => {
  const tmp = scratch("fish-url-");
  const cases = fixture();
  const authority = /^[a-zA-Z][a-zA-Z0-9+.-]*:[/\\]*([^/\\?#]*)/;
  // A target goes on the request line, so it holds no space or line break, and starts with '/'.
  let targets: string[] = [];
  let hosts: string[] = [];
  for (const c of cases) {
    targets.push(c.input.replace(authority, ""));
    targets.push(c.pathname ?? "");
    const m = authority.exec(c.input);
    let named = "";
    if (m !== null) named = m[1];
    let at = named.split("@");
    hosts.push(at.pop() ?? "");
    hosts.push(c.host ?? "");
  }
  targets = targets.map((t) => (t.startsWith("/") ? t : "/" + t));
  for (const t of ["/a/../b", "/a/%2e%2e/b", "/a/.%2E/b", "/a/./b", "/%2e/x", "/a\\b", "/a\\..\\b", "/admin/x"]) targets.push(t);
  // The server refuses outright a Host with a space, control, '/', '?', '#', '@', ',' or '\', so
  // only the rest reach the parser's rules.
  for (const h of ["h", "h:8080", "h:abc", "a^b", "[::1", "a%zz", "h:", ":80", "[::1]:99999", "1.2.3.256", "0x7f.1"]) hosts.push(h);
  // Bun's test also drops strings that aren't well-formed UTF-16; a Fish string is UTF-8 and always
  // well-formed, and the slice holds no lone surrogate, so there is nothing to drop.
  let paths: string[] = [];
  let seen = new Set<string>();
  for (const t of targets) {
    if (!/[\0\n\r ]/.test(t)) once(paths, seen, t);
  }
  let named: string[] = [];
  let seenHosts = new Set<string>();
  for (const h of hosts) {
    if (h.length > 0 && !/[\0-\x20\x7f/?#@,\\]/.test(h)) once(named, seenHosts, h);
  }
  same(`${paths.length} ${named.length}`, "384 323", "the corpus's paths and hosts");

  const oracle = built(tmp, "oracle", `import { readFileSync } from "node:fs";
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
  write(corpus, JSON.stringify({ paths: paths.clone(), hosts: named.clone() }));
  const total = paths.length + named.length;
  const want = text(spawnSync(oracle, [corpus]).stdout).split("\n").slice(0, total as i64);

  const server = `async function main(): Promise<void> throws IoError {
  await serve({ port: 0, hostname: "127.0.0.1", onListen: (info: ServeInfo) => { console.error(info.port); } }, async (req) => new Response(req.path));
}
`;
  const serverFile = join(tmp, "server.fsh");
  write(serverFile, server);
  // The server's program names nothing that brings the parser.
  const ir = fishc(tmp, ["build", serverFile, "--emit-llvm"]).out;
  assert(!ir.includes('@"fsh.url parse"'), "the server's program brings the URL parser");
  const serverOut = built(tmp, "server", server);
  const clientOut = built(tmp, "client", client());
  const script = `"$1" 2> "$2" & pid=$!
n=0
while ! grep -q . "$2" 2> /dev/null && [ $n -lt 100 ]; do sleep 0.05; n=$((n + 1)); done
"$3" "$4" "$(head -n 1 "$2")"
kill $pid`;
  const run = spawnSync("sh", ["-c", script, "sh", serverOut, join(tmp, "port"), clientOut, corpus]);
  same(text(run.stderr), "", "the client's stderr");
  const got = text(run.stdout).split("\n").slice(0, total as i64);
  let label: string[] = paths.map((t) => `path ${t}`);
  label = label.concat(named.map((h) => `host ${h}`));
  let wrong: string[] = [];
  for (let i: usize = 0; i < label.length; i++) {
    const g = i < got.length ? got[i] : "(nothing)";
    const w = i < want.length ? want[i] : "(nothing)";
    if (g !== w) wrong.push(`${label[i]}: expected ${w}, got ${g}`);
  }
  assert(wrong.length === 0, `${wrong.length} requests differ:\n${wrong.join("\n")}`);
  removed(tmp);
}, { timeout: 120_000 });
