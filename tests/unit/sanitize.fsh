// `fishc build --sanitize address|thread`, the program, std and the C
// runtime instrumented by one of clang's sanitizers, its reports naming .fsh lines. Resolving the
// target is tested in process; the runtime's compile flags are read from what the native fishc
// hands clang; and every build is the native fishc's. The fetch test's server is a Node child
// process.
import type { Subprocess } from "bun";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hostTarget, instrumented, resolveTarget, sanitizedTarget, staticTarget, type Target } from "../../src/target.fsh";
import { fishc, removed, runtimeArgs, same, scratch, text } from "./support.fsh";

function write(path: string, contents: string): void {
  try {
    writeFileSync(path, contents);
  } catch (e) {
    assert(false, `can't write ${path}: ${e.message}`);
  }
}

function made(path: string): void {
  try {
    mkdirSync(path, { recursive: true });
  } catch (e) {
    assert(false, `can't make ${path}: ${e.message}`);
  }
}

// The message `run` throws, or "" when it throws nothing.
function thrown(run: () => Target throws Error | IoError): string {
  try {
    const _t = run();
    return "";
  } catch (e) {
    return e.message;
  }
}

function throwsWith(run: () => Target throws Error | IoError, message: string): void {
  const got = thrown(run);
  assert(got.includes(message), `expected a throw containing ${message}, got: ${got === "" ? "no throw" : got}`);
}

function target(run: () => Target throws Error | IoError): Target {
  try {
    return run();
  } catch (e) {
    assert(false, e.message);
    return hostTarget();
  }
}

// Why clang can't build for the host with `kind`, or "" when it can.
function unsupported(kind: string): string {
  return thrown(() => sanitizedTarget(hostTarget(), [kind]));
}

// Whether builds with `kind` can run here, saying why not when they can't.
function can(kind: string): boolean {
  const why = unsupported(kind);
  if (why !== "") console.log(`skipping ${kind} sanitizer builds: ${why}`);
  return why === "";
}

type Ran = { code: i64; out: string; err: string };

// Builds `src` as `main.fsh` in the directory `name` under `root` with `args`, then runs it.
function run(root: string, name: string, src: string, args: string[]): Ran {
  const dir = join(root, name);
  made(dir);
  write(join(dir, "main.fsh"), src);
  const built = fishc(dir, ["build", "main.fsh", "-o", "main", ...args]);
  assert(built.code === 0, `building ${name} exited with ${built.code}:\n${built.err}`);
  const done = spawnSync(join(dir, "main"), [], { cwd: dir });
  return { code: done.status ?? -1, out: text(done.stdout), err: text(done.stderr) };
}

function has(_tool: string): string | null {
  return "/bin/lld";
}

// A runtime directory lookup giving `dir` for every triple.
function inside(dir: string): (triple: string) => string throws IoError | Error {
  return move (_t: string) => dir.clone();
}

function anywhere(_triple: string): string {
  return "/runtime";
}

test("a sanitizer instruments every compile and keeps frame pointers", () => {
  const root = scratch("fish-sanitize-");
  // A runtime directory holding no sanitizer library refuses the target.
  throwsWith(() => sanitizedTarget(hostTarget(), ["address"], "aarch64-apple-darwin", inside(root)), "fishc build: clang has no address sanitizer runtime for aarch64-apple-darwin; build for a target it has one for, such as the host's own");
  const dir = join(root, "runtime");
  made(dir);
  write(join(dir, "libclang_rt.tsan_osx_dynamic.dylib"), "");
  write(join(dir, "libclang_rt.asan-x86_64.a"), "");
  const mac = target(() => sanitizedTarget(hostTarget(), ["thread"], "aarch64-apple-darwin", inside(dir)));
  const wanted: Target = { triple: "", compile: ["-fsanitize=thread", "-fno-omit-frame-pointer"], link: [], ar: "ar", sanitize: "thread" };
  assert(mac === wanted, `the thread target: ${JSON.stringify(mac)}`);
  const linux = target(() => resolveTarget("x86_64-unknown-linux-gnu", "/s", "aarch64-apple-darwin", has));
  const address = target(() => sanitizedTarget(resolveTarget("x86_64-unknown-linux-gnu", "/s", "aarch64-apple-darwin", has), ["address"], "aarch64-apple-darwin", inside(dir)));
  assert(address.compile === [...linux.compile, "-fsanitize=address", "-fno-omit-frame-pointer"], `the address target's compile flags: ${JSON.stringify(address.compile)}`);
  throwsWith(() => sanitizedTarget(resolveTarget("x86_64-unknown-linux-gnu", "/s", "aarch64-apple-darwin", has), ["thread"], "aarch64-apple-darwin", inside(dir)), "clang has no thread sanitizer runtime for x86_64-unknown-linux-gnu");
  removed(root);
}, { timeout: 120_000 });

test("one known sanitizer at a time, for a target clang has its runtime for", () => {
  throwsWith(() => sanitizedTarget(hostTarget(), ["memory"], "aarch64-apple-darwin", anywhere), "fishc build: unknown sanitizer 'memory'; use one of address, thread");
  throwsWith(() => sanitizedTarget(hostTarget(), ["address", "thread"], "aarch64-apple-darwin", anywhere), "fishc build: --sanitize takes one sanitizer at a time; address and thread can't instrument the same build");
  throwsWith(() => sanitizedTarget(resolveTarget("x86_64-unknown-linux-musl", "/s", "aarch64-apple-darwin", has), ["address"], "aarch64-apple-darwin", anywhere), "clang has no address sanitizer runtime for x86_64-unknown-linux-musl");
  throwsWith(() => sanitizedTarget(staticTarget(resolveTarget("x86_64-unknown-linux-musl", "/s", "aarch64-apple-darwin", has), "aarch64-apple-darwin"), ["thread"], "aarch64-apple-darwin", anywhere), "fishc build: --sanitize=thread links clang's sanitizer runtime, which a --static build can't; leave out one of them");
}, { timeout: 120_000 });

function sanitizing(kind: string): Target {
  return { triple: "", compile: [], link: [], ar: "ar", sanitize: kind };
}

test("each definition in the IR is marked for the sanitizer, and an unsanitized build's left alone", () => {
  const ir = 'define internal void @"fsh.constants"() {\ndefine internal { i64, ptr } @"fsh.f"(ptr %p) uwtable personality ptr @__gcc_personality_v0 {\ndeclare void @free(ptr)\n  ; define x {';
  same(instrumented(ir, sanitizing("thread")), 'define internal void @"fsh.constants"() sanitize_thread noinline {\ndefine internal { i64, ptr } @"fsh.f"(ptr %p) sanitize_thread noinline uwtable personality ptr @__gcc_personality_v0 {\ndeclare void @free(ptr)\n  ; define x {', "the thread-sanitized IR");
  assert(instrumented(ir, sanitizing("address")).includes("sanitize_address noinline uwtable personality"), "the address-sanitized IR");
  same(instrumented(ir, hostTarget()), ir, "the unsanitized IR");
  // A symbol can hold a space, and so the word itself.
  const named = 'define internal i64 @"fsh.C.static uwtable"() uwtable personality ptr @__gcc_personality_v0 {';
  same(instrumented(named, sanitizing("address")), 'define internal i64 @"fsh.C.static uwtable"() sanitize_address noinline uwtable personality ptr @__gcc_personality_v0 {', "a symbol holding uwtable");
}, { timeout: 120_000 });

// Read from builds rather than from `runtimeUnits`, so the host needs the address sanitizer's
// runtime for this one.
test("an instrumented runtime is cached apart from a plain one, a dev build's at -O1", () => {
  if (!can("address")) return;
  const root = scratch("fish-sanitize-");
  const file = join(root, "hello.fsh");
  write(file, `function main() { console.log("hello"); }\n`);
  const [plain, plainName] = runtimeArgs(root, file, []);
  const [address, addressName] = runtimeArgs(root, file, ["--sanitize", "address"]);
  const words = plain.split(" ");
  // -O1 stands in for -O0 and for the instruction selector ARM64 Linux picks beside it, which
  // only -O0 uses.
  same(address, ["-x", "c", "-", "-fsanitize=address", "-fno-omit-frame-pointer", ...words.slice(3).filter((a) => a !== "-fno-global-isel").map((a) => (a === "-O0" ? "-O1" : a))].join(" "), "the address-sanitized runtime's flags");
  assert(words.includes("-O0"), `the plain runtime's flags: ${plain}`);
  same(`${plainName} ${addressName}`, "runtime runtime", "the runtimes' object names");
  removed(root);
}, { timeout: 120_000 });

test("--sanitize refused where it can't apply", () => {
  const root = scratch("fish-sanitize-");
  write(join(root, "lib.fsh"), "export function f(): i64 {\n  return 1;\n}\n");
  const checks: [string[], string][] = [
    [["build", "lib.fsh", "--sanitize", "address", "--lib", "-o", "libf.a"], "2 fishc build: '--sanitize' can't build a library; build the program that uses it with '--sanitize' instead\n"],
    [["build", "lib.fsh", "--sanitize", "address", "--emit-llvm"], "2 fishc build: '--emit-llvm' prints the IR before clang instruments it, so '--sanitize' doesn't apply; leave it out\n"],
    [["run", "lib.fsh", "--sanitize", "address"], "2 fishc run: '--sanitize' instruments a build; build with 'fishc build --sanitize address|thread', then run the binary it writes\n"],
    [["check", "lib.fsh", "--sanitize", "address"], "2 fishc check: '--sanitize' instruments a build; build with 'fishc build --sanitize address|thread', then run the binary it writes\n"],
    [["watch", "lib.fsh", "--sanitize", "address"], "2 fishc watch: '--sanitize' instruments a build; build with 'fishc build --sanitize address|thread', then run the binary it writes\n"],
    [["build", "lib.fsh", "--sanitize=address,thread"], "1 fishc build: --sanitize takes one sanitizer at a time; address and thread can't instrument the same build\n"],
    [["build", "lib.fsh", "--sanitize", "address", "--sanitize", "thread"], "1 fishc build: --sanitize takes one sanitizer at a time; address and thread can't instrument the same build\n"],
  ];
  for (const [args, want] of checks) {
    const got = fishc(root, args.clone());
    same(`${got.code} ${got.err}`, want, `fishc ${args.join(" ")}`);
  }
  removed(root);
}, { timeout: 120_000 });

test("the address sanitizer reports a use after free at its .fsh lines", () => {
  if (!can("address")) return;
  const root = scratch("fish-sanitize-");
  const src = `declare function malloc(size: usize): MutPtr<i64>;
declare function free(p: MutPtr<i64>): void;

function main() {
  const p = unsafe { malloc(8) };
  unsafe {
    p.write(1);
    free(p);
  }
  console.log(unsafe { p.read() });
}
`;
  const got = run(root, "use-after-free", src, ["--sanitize", "address"]);
  assert(got.code !== 0, "the program exited with 0");
  assert(got.err.includes("ERROR: AddressSanitizer: heap-use-after-free"), `stderr:\n${got.err}`);
  assert(/READ of size 8 [^\n]*\n\s+#0 [^\n]* in fsh\.main [^\n]*main\.fsh:10/.test(got.err), `no read at main.fsh:10 in:\n${got.err}`);
  assert(/freed by thread T0 here:\n[^\n]*\n\s+#1 [^\n]* in fsh\.main [^\n]*main\.fsh:8/.test(got.err), `no free at main.fsh:8 in:\n${got.err}`);
  removed(root);
}, { timeout: 120_000 });

// Fails the test unless the program ran clean, giving `out`.
function clean(got: Ref<Ran>, out: string): void {
  same(got.err, "", "stderr");
  same(`${got.code} ${got.out}`, `0 ${out}`, "the exit code and stdout");
}

// A field a check narrowed is read, written and lent inside its union's payload, through a class's
// boxed field and a parameter whose argument stores the field as a narrower type.
test("narrowed fields run clean under the address sanitizer", () => {
  if (!can("address")) return;
  const root = scratch("fish-sanitize-");
  const src = `class Node {
  value: i64
  next: Node | null
  constructor(value: i64, next: Node | null) {
    this.value = value
    this.next = next
  }
  bump(this: Mut<this>) {
    this.value = this.value + 10
  }
}
type Box = { label: string | null }
function shout(s: Mut<string>) {
  s = s + "!"
}
function clear(o: Mut<string | null>) {
  o = null
}
function len(b: Box): usize {
  return b.label !== null ? b.label.length : 0
}
function reset(n: Mut<Node>) {
  n.next = null
}
function main() {
  let n = new Node(1, new Node(2, null))
  for (let i = 0; i < 2; i++) {
    if (n.next !== null) {
      n.next.value = n.next.value + 3
      n.next.bump()
      console.log(n.next.value)
      reset(n)
    }
  }
  let b: Box = { label: "hi" }
  if (b.label !== null) {
    shout(b.label)
    console.log(b.label)
    clear(b.label)
  }
  const wide = { label: "abc", extra: 1 }
  const empty = { label: null, extra: 2 }
  console.log(len(b), len(wide), len(empty))
}
`;
  clean(run(root, "narrowed-fields", src, ["--sanitize", "address"]), "15\nhi!\n0 3 0\n");
  removed(root);
}, { timeout: 120_000 });

// References held in Option fields and in a tagged union's members are pointers in the payload,
// read and written through once narrowed, with nothing dropped through them.
test("unions holding references run clean under the address sanitizer", () => {
  if (!can("address")) return;
  const root = scratch("fish-sanitize-");
  const src = `class Expr {
  text: string
  constructor(text: string) {
    this.text = text
  }
}
class Stmt {
  line: i64 = 3
}
type AnyNode = { of: "expr"; node: Ref<Expr> } | { of: "stmt"; node: Mut<Stmt> }
class Holder {
  item: Ref<Expr> | undefined
  constructor(item: Ref<Expr> | undefined) {
    this.item = item
  }
}
function show(n: Ref<AnyNode>): string {
  if (n.of === "expr") return n.node.text + "!"
  return \`line \${n.node.line}\`
}
function main() {
  const e = new Expr("hello")
  let s = new Stmt()
  const h = new Holder(e)
  if (h.item !== undefined) console.log(h.item.text)
  const a: AnyNode = { of: "expr", node: e }
  console.log(show(a))
  const b: AnyNode = { of: "stmt", node: s }
  if (b.of === "stmt") b.node.line = 9
  console.log(show(b))
  console.log(s.line)
}
`;
  clean(run(root, "union-refs", src, ["--sanitize", "address"]), "hello\nhello!\nline 9\n9\n");
  removed(root);
}, { timeout: 120_000 });

// An array of references holds pointers it never frees through: pushed, read, written, popped
// and looped over, with the buffer freed once and nothing its elements point at freed with it.
test("arrays of references run clean under the address sanitizer", () => {
  if (!can("address")) return;
  const root = scratch("fish-sanitize-");
  const src = `class Expr {
  text: string
  constructor(text: string) {
    this.text = text
  }
}
type AnyNode = { of: "expr"; node: Ref<Expr> } | { of: "none" }
class Stack {
  items: Ref<Expr>[] = []
  add(this: Mut<this>, e: Ref<Expr>) {
    this.items.push(e)
  }
}
function main() {
  const a = new Expr("a" + 1)
  const b = new Expr("b" + 2)
  let st: Ref<Expr>[] = [a]
  for (let i = 0; i < 40; i++) st.push(i % 2 === 0 ? a : b)
  st[0] = b
  let total = 0
  for (const e of st) total += e.text.length
  while (st.length > 3) st.pop()
  const top = st.pop()!
  console.log(total, st.length, top.text)
  let nodes: AnyNode[] = [{ of: "expr", node: a }, { of: "none" }]
  nodes.push({ of: "expr", node: b })
  for (const n of nodes) console.log(n.of === "expr" ? n.node.text : n.of)
  const last = nodes.pop()!
  if (last.of === "expr") console.log(last.node.text)
  let held = new Stack()
  held.add(a)
  held.add(b)
  console.log(held.items[1].text, held.items.length)
}
`;
  clean(run(root, "ref-arrays", src, ["--sanitize", "address"]), "82 2 b2\na1\nnone\nb2\nb2\nb2 2\n");
  removed(root);
}, { timeout: 120_000 });

// The array methods copy pointers between buffers and free each buffer once: copies, joins,
// inserts, spreads, clones and what a callback gives back, with the referents untouched.
test("array methods over references run clean under the address sanitizer", () => {
  if (!can("address")) return;
  const root = scratch("fish-sanitize-");
  const src = `class Expr {
  text: string
  constructor(text: string) {
    this.text = text
  }
}
function main() {
  const a = new Expr("a" + 1)
  const b = new Expr("b" + 2)
  const c = new Expr("c" + 3)
  let st: Ref<Expr>[] = [a, b]
  for (let i = 0; i < 20; i++) st.push(i % 2 === 0 ? a : b)
  const firsts = st.filter((e) => e.text === "a1").concat(st.slice(0, 2)).toReversed()
  st.unshift(c)
  st.splice(1, 2, c, c)
  const swapped = st.with(0, a).toSpliced(1, 1, b)
  const copy = [...st, c].clone()
  const texts = st.map((e) => e).toSorted((p, q) => p.text < q.text ? -1 : p.text > q.text ? 1 : 0)
  const longest = st.reduce((best, e) => e.text.length > best.text.length ? e : best)
  let owned = [new Expr("o" + 1), new Expr("o" + 2)]
  const lent = owned.map((e) => e)
  console.log(firsts.length, firsts[0].text, st.at(0)!.text, st.find((e) => e.text === "b2")!.text)
  console.log(swapped.length, swapped[0].text, swapped[1].text, copy.length, texts[0].text, longest.text)
  console.log(lent[1].text, st.shift()!.text, st.length)
  console.log([a, b].slice(1))
}
`;
  clean(run(root, "ref-array-methods", src, ["--sanitize", "address"]), "13 b2 c3 b2\n23 a1 b2 24 a1 c3\no2 c3 22\n[ Expr { text: 'b2' } ]\n");
  removed(root);
}, { timeout: 120_000 });

// A server answering one request with "ok" and writing what it was sent: its method, path, x-tag
// header and body.
function server(): string {
  return String.raw`const fs = require("node:fs");
const [portFile, seenFile] = process.argv.slice(2);
const s = require("node:http").createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    fs.writeFileSync(seenFile, req.method + " " + new URL(req.url, "http://h").pathname + " " + (req.headers["x-tag"] ?? null) + " " + body);
    res.end("ok");
  });
});
s.listen(0, "127.0.0.1", () => fs.writeFileSync(portFile + ".part", String(s.address().port)) || fs.renameSync(portFile + ".part", portFile));
`;
}

function readOr(path: string): string {
  try {
    return existsSync(path) ? readFileSync(path, "utf8") : "";
  } catch (_e) {
    return "";
  }
}

// Clang's -O0 code for AArch64 misread large aggregates passed to address-sanitized functions,
// so fetch's init arrived empty and the request went out as a bare GET.
test("an address-sanitized fetch sends the method, headers and body it was given", async () => {
  if (!can("address")) return;
  const root = scratch("fish-sanitize-");
  const script = join(root, "server.cjs");
  write(script, server());
  const portFile = join(root, "port");
  const seenFile = join(root, "seen");
  let node: Subprocess | null = null;
  try {
    node = Bun.spawn(["node", script, portFile, seenFile], { stdout: "ignore", stderr: "ignore" });
  } catch (e) {
    assert(false, `can't start node: ${e.message}`);
  }
  const deadline = Date.now() + 5000;
  while (readOr(portFile) === "" && Date.now() < deadline) await sleep(20);
  const port = readOr(portFile);
  let failure = port === "" ? "the server never said its port" : "";
  if (failure === "") {
    const dir = join(root, "fetch");
    made(dir);
    write(join(dir, "main.fsh"), `async function main(): Promise<void> throws IoError | AbortError {
  let headers = new Headers();
  headers.set("x-tag", "t1");
  const res = await fetch("http://127.0.0.1:${port}/up", { method: "POST", headers, body: "y".repeat(10) });
  const text = await res.text();
  console.log(res.status, text);
}
`);
    const built = fishc(dir, ["build", "main.fsh", "-o", "main", "--sanitize", "address"]);
    if (built.err !== "" || built.code !== 0) failure = `building the program exited with ${built.code}:\n${built.err}`;
    else {
      const ran = spawnSync(join(dir, "main"), [], { cwd: dir });
      const got = `${ran.status ?? -1} ${text(ran.stdout)}${text(ran.stderr)}`;
      if (got !== "0 200 ok\n") failure = `the program gave, as its exit code, stdout and stderr:\n${got}`;
    }
  }
  if (node !== null) {
    node.kill("SIGKILL");
    const _code = await node.exited;
  }
  assert(failure === "", failure);
  same(readOr(seenFile), "POST /up t1 yyyyyyyyyy", "what the server was sent");
  removed(root);
}, { timeout: 120_000 });

test("the thread sanitizer reports two tasks racing on raw memory", () => {
  if (!can("thread")) return;
  const root = scratch("fish-sanitize-");
  // Each task waits for the other to have started before it writes: on a busy machine with few
  // cores one worker would otherwise run them one after the other, which is no race. The wait is
  // bounded, so a machine with one thread fails the test rather than hanging it.
  const src = `type Gate = { started: Atomic<i64> };
async function bump(address: usize, gate: shared<Gate>): Promise<i64> {
  gate.started.add(1);
  for (let waited = 0; waited < 200000000 && gate.started.load() < 2; waited++) {}
  for (let i = 0; i < 100000; i++) {
    unsafe {
      const p = address as MutPtr<i64>;
      p.write(p.read() + 1);
    }
  }
  return 0;
}

async function main() {
  let count = 0;
  const address = unsafe { mutPtrOf(count) as usize };
  const gate = shared<Gate>({ started: new Atomic(0) });
  const a = spawn(bump(address, gate.clone()));
  const b = spawn(bump(address, gate.clone()));
  await a;
  await b;
  console.log("done");
}
`;
  const got = run(root, "race", src, ["--sanitize", "thread"]);
  assert(got.code !== 0, "the program exited with 0");
  assert(got.err.includes("WARNING: ThreadSanitizer: data race"), `stderr:\n${got.err}`);
  assert(/#0 fsh\.bump [^\n]*main\.fsh:8/.test(got.err), `no race at main.fsh:8 in:\n${got.err}`);
  removed(root);
}, { timeout: 120_000 });

test("the runtime's executor, channels, locks and blocking pool run clean under the thread sanitizer", () => {
  if (!can("thread")) return;
  const root = scratch("fish-sanitize-");
  const src = `class Pool {
  hits: Atomic<i64> = new Atomic(0);
  log: Lock<string[]> = new Lock<string[]>([]);
}

type State = { count: i64; pool: Pool };

async function work(state: shared<State>, out: Channel<i64>, n: i64): Promise<i64> {
  for (let i = 0; i < 50; i++) {
    state.pool.hits.add(1);
    state.update((s) => s.count++);
    if (i % 10 === 0) await yieldNow();
  }
  state.pool.log.update((l) => l.push("task" + n));
  await out.send(n);
  return n;
}

async function spin(): Promise<i64> {
  let n = 0;
  while (true) n++;
  return n;
}

async function main() {
  const state = shared<State>({ count: 0, pool: new Pool() });
  const out = new Channel<i64>(4);
  let handles: JoinHandle<i64>[] = [];
  for (let n = 0; n < 8; n++) handles.push(spawn(work(state.clone(), out.clone(), n)));
  let sum = 0;
  for (let n = 0; n < 8; n++) {
    const v = await out.receive();
    sum += v!;
  }
  for (let n = 0; n < 8; n++) await handles.pop()!;
  const blocked = await spawnBlocking(() => 6 * 7);
  const count = state.update((s) => s.count);
  console.log(sum, count, state.pool.hits.load(), state.pool.log.update((l) => l.length), blocked);
  // Main ends while a task is still busy, so the runtime abandons its workers.
  const _busy = spawn(spin());
}
`;
  clean(run(root, "clean", src, ["--sanitize", "thread"]), "28 400 400 8 42\n");
  removed(root);
}, { timeout: 120_000 });
