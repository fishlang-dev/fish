// case: trace_context
// expect: a child shares its parent's trace: true
// expect: a child names its parent: true
// expect: a root has no parent: true
// expect: ids are lowercase hex, 32 digits and 16: true
// expect: the parent is current again after end: true
// expect: ending twice changes nothing: true
// expect: a span after an await is still a child: true
// expect: a spawned task's span is a child of the spawner's: true
// expect: the spawner's current span is still its own: true
// expect: a new trace starts once every span has ended: true
// expect: ending a span that isn't current leaves the current one: true
// The current span follows its task through awaits and into the tasks it spawns. Ids are
// random, so each line says how two of them relate. The endpoint is this program's own server.
import { span, configureTracing } from "fish:trace";

async function collect(got: shared<{ port: Atomic<i64> }>): Promise<void> throws IoError {
  const seen = got.clone();
  await serve({ port: 0, hostname: "127.0.0.1", trace: false, onListen: (info: ServeInfo) => { seen.port.store(info.port); } }, async (_req: Request) => new Response("{}"));
}

async function inTask(parent: string, trace: string): Promise<boolean> {
  let s = span("in a task");
  await sleep(1);
  const ok = s.parentSpanId === parent && s.traceId === trace;
  s.end();
  return ok;
}

async function main(): Promise<void> {
  const got = shared({ port: new Atomic(0) });
  spawn(collect(got.clone()));
  while (got.port.load() === 0) await sleep(1);
  configureTracing({ endpoint: "http://127.0.0.1:" + String(got.port.load()), serviceName: "golden", batchDelay: 10 });
  let root = span("root");
  let child = span("child");
  console.log("a child shares its parent's trace:", child.traceId === root.traceId);
  console.log("a child names its parent:", child.parentSpanId === root.spanId);
  console.log("a root has no parent:", root.parentSpanId === "");
  console.log("ids are lowercase hex, 32 digits and 16:", /^[0-9a-f]{32}$/.test(root.traceId) && /^[0-9a-f]{16}$/.test(child.spanId));
  child.end();
  let second = span("second");
  console.log("the parent is current again after end:", second.parentSpanId === root.spanId);
  second.end();
  second.end();
  let third = span("third");
  console.log("ending twice changes nothing:", third.parentSpanId === root.spanId);
  third.end();
  await sleep(1);
  let later = span("later");
  console.log("a span after an await is still a child:", later.parentSpanId === root.spanId && later.traceId === root.traceId);
  later.end();
  const task = spawn(inTask(root.spanId, root.traceId));
  let beside = span("beside the task");
  const inherited = await task;
  console.log("a spawned task's span is a child of the spawner's:", inherited);
  console.log("the spawner's current span is still its own:", beside.parentSpanId === root.spanId);
  beside.end();
  root.end();
  let fresh = span("fresh");
  console.log("a new trace starts once every span has ended:", fresh.parentSpanId === "" && fresh.traceId !== root.traceId);
  let inner = span("inner");
  fresh.end();
  let under = span("under the one still open");
  console.log("ending a span that isn't current leaves the current one:", under.parentSpanId === inner.spanId);
  under.end();
  inner.end();
}
// case: trace_off
// expect: ids are empty when tracing is off: true true true
// An empty endpoint is off whatever OTEL_EXPORTER_OTLP_ENDPOINT says where this runs.
import { span, configureTracing } from "fish:trace";

async function main(): Promise<void> {
  configureTracing({ endpoint: "" });
  let s = span("unseen");
  s.set("key", "value");
  let under = span("under it");
  console.log("ids are empty when tracing is off:", s.traceId === "", s.spanId === "", under.parentSpanId === "");
  under.end();
  s.end();
}
// case: trace_export
// expect: POST /v1/traces
// expect: content-type: application/json
// expect: service.name: golden
// expect: load "user" <- checkout, same trace: true, kind 1, times in nanoseconds: true
// expect:   user.id: string ada
// expect:   rows: int 42
// expect:   cached: bool true
// expect: checkout <- nothing, same trace: true, kind 1, times in nanoseconds: true
// expect: flushed: 1 batch
// expect: main returns with a span still to send
// expect: POST /v1/traces
// expect: content-type: application/json
// expect: service.name: golden
// expect: last <- nothing, same trace: true, kind 1, times in nanoseconds: true
// A stand-in collector in the same program prints what it is sent: one batch at flushTraces,
// and one the batch timer sends after main has returned, which the program waits for.
import { span, configureTracing, flushTraces } from "fish:trace";

type Sent = { resourceSpans: { resource: { attributes: { key: string; value: { stringValue?: string } }[] }; scopeSpans: { spans: { traceId: string; spanId: string; parentSpanId?: string; name: string; kind: i64; startTimeUnixNano: string; endTimeUnixNano: string; attributes: { key: string; value: AnyValue }[] }[] }[] }[] };
// An attribute's value, under the name of its type.
type AnyValue = { stringValue?: string; intValue?: string; boolValue?: boolean };

function typed(v: Ref<AnyValue>): string {
  const text = v.stringValue;
  if (text !== null) return "string " + text;
  const int = v.intValue;
  if (int !== null) return "int " + int;
  const bool = v.boolValue;
  return bool !== null ? "bool " + String(bool) : "?";
}

// A batch as lines: each span, the span in the batch that is its parent, and its attributes.
function described(text: string): string {
  let out = "";
  try {
    const sent = JSON.parse<Sent>(text);
    for (const r of sent.resourceSpans) {
      for (const a of r.resource.attributes) out += a.key + ": " + (a.value.stringValue ?? "?") + "\n";
      for (const scope of r.scopeSpans) {
        for (const s of scope.spans) {
          let parent = s.parentSpanId === null ? "nothing" : "a span not in the batch";
          for (const other of scope.spans) if (s.parentSpanId === other.spanId) parent = other.name;
          const timed = /^[0-9]{19}$/.test(s.startTimeUnixNano) && /^[0-9]{19}$/.test(s.endTimeUnixNano) && s.endTimeUnixNano >= s.startTimeUnixNano;
          out += s.name + " <- " + parent + ", same trace: " + String(s.traceId === scope.spans[0].traceId) + ", kind " + String(s.kind) + ", times in nanoseconds: " + String(timed) + "\n";
          for (const a of s.attributes) out += "  " + a.key + ": " + typed(a.value) + "\n";
        }
      }
    }
  } catch (e) {
    out += "not the JSON expected: " + text + "\n";
  }
  return out;
}

async function collect(got: shared<{ port: Atomic<i64>; posts: Atomic<i64> }>): Promise<void> throws IoError {
  const seen = got.clone();
  const counted = got.clone();
  await serve({ port: 0, hostname: "127.0.0.1", trace: false, onListen: (info: ServeInfo) => { seen.port.store(info.port); } }, async (req: Request) => {
    const head = req.method + " " + req.path + "\ncontent-type: " + (req.headers.get("content-type") ?? "none") + "\n";
    const body = await req.text();
    counted.posts.add(1);
    // One write, so a line of main's can't land inside a batch's.
    console.log(head + described(body).trimEnd());
    return new Response("{}");
  });
}

async function main(): Promise<void> {
  const got = shared({ port: new Atomic(0), posts: new Atomic(0) });
  spawn(collect(got.clone()));
  while (got.port.load() === 0) await sleep(1);
  // The delay is long enough that only the flush sends the first batch.
  configureTracing({ endpoint: "http://127.0.0.1:" + String(got.port.load()), serviceName: "golden", batchDelay: 2000 });
  let checkout = span("checkout");
  let load = span("load \"user\"");
  load.set("user.id", "ada");
  load.set("rows", 42);
  load.set("cached", true);
  load.end();
  load.set("late", "dropped");
  checkout.end();
  await flushTraces();
  console.log("flushed:", got.posts.load(), "batch");
  configureTracing({ endpoint: "http://127.0.0.1:" + String(got.port.load()), serviceName: "golden", batchDelay: 20 });
  let last = span("last");
  console.log("main returns with a span still to send");
  last.end();
}
// case: trace_serve
// expect: /users/7 gave 200 ok
// expect: /boom gave 500
// expect: /plain gave 200 ok
// expect: /users/8 gave 200 ok
// expect: batches by the time serve returned: 1
// expect: service.name: golden
// expect: load user <- GET, kind 1, in the caller's trace: true
// expect:   user.id: int 7
// expect: GET <- the caller's span, kind 2, in the caller's trace: true
// expect:   http.request.method: string GET
// expect:   url.path: string /users/7
// expect:   http.response.status_code: int 200
// expect: GET <- nothing, kind 2, in the caller's trace: false
// expect:   http.request.method: string GET
// expect:   url.path: string /boom
// expect:   http.response.status_code: int 500
// expect: GET <- nothing, kind 2, in the caller's trace: false
// expect:   http.request.method: string GET
// expect:   url.path: string /plain
// expect:   http.response.status_code: int 200
// expect: /plain gave 200 ok
// expect: batches from a server with trace: false: 0
// serve gives each request a span its handler's spans go under. A traceparent header puts it
// in its caller's trace, a malformed one is ignored, and one whose caller didn't sample the
// trace is followed but not exported. A handler that panics still ends its span, with the 500
// its client gets. The spans go out as serve returns, and a server with trace: false has none.
import { span, configureTracing, flushTraces } from "fish:trace";

type Sent = { resourceSpans: { resource: { attributes: { key: string; value: AnyValue }[] }; scopeSpans: { spans: { traceId: string; spanId: string; parentSpanId?: string; name: string; kind: i64; attributes: { key: string; value: AnyValue }[] }[] }[] }[] };
// An attribute's value, under the name of its type.
type AnyValue = { stringValue?: string; intValue?: string; boolValue?: boolean };

// The caller's trace and span, as its traceparent header names them.
const TRACE = "0af7651916cd43dd8448eb211c80319c";
const CALLER = "b7ad6b7169203331";

function typed(v: Ref<AnyValue>): string {
  const text = v.stringValue;
  if (text !== null) return "string " + text;
  const int = v.intValue;
  if (int !== null) return "int " + int;
  const bool = v.boolValue;
  return bool !== null ? "bool " + String(bool) : "?";
}

// A batch as lines: each span, what it is under, and its attributes.
function described(text: string): string {
  let out = "";
  try {
    const sent = JSON.parse<Sent>(text);
    for (const r of sent.resourceSpans) {
      for (const a of r.resource.attributes) out += a.key + ": " + typed(a.value).slice(7) + "\n";
      for (const scope of r.scopeSpans) {
        for (const s of scope.spans) {
          let parent = s.parentSpanId === null ? "nothing" : s.parentSpanId === CALLER ? "the caller's span" : "a span not in the batch";
          for (const other of scope.spans) if (s.parentSpanId === other.spanId) parent = other.name;
          out += s.name + " <- " + parent + ", kind " + String(s.kind) + ", in the caller's trace: " + String(s.traceId === TRACE) + "\n";
          for (const a of s.attributes) out += "  " + a.key + ": " + typed(a.value) + "\n";
        }
      }
    }
  } catch (e) {
    out += "not the JSON expected: " + text + "\n";
  }
  return out;
}

async function collect(got: shared<{ port: Atomic<i64>; posts: Lock<string[]> }>): Promise<void> throws IoError {
  const seen = got.clone();
  const kept = got.clone();
  await serve({ port: 0, hostname: "127.0.0.1", trace: false, onListen: (info: ServeInfo) => { seen.port.store(info.port); } }, async (req: Request) => {
    const body = await req.text();
    kept.posts.update((p) => { p.push(body); });
    return new Response("{}");
  });
}

async function app(found: shared<{ port: Atomic<i64> }>, stop: AbortSignal, traced: boolean): Promise<void> throws IoError {
  const seen = found.clone();
  await serve({ port: 0, hostname: "127.0.0.1", signal: stop, trace: traced, onListen: (info: ServeInfo) => { seen.port.store(info.port); } }, async (req: Request) => {
    assert(req.path !== "/boom", "the handler gives up");
    if (req.path.startsWith("/users/")) {
      let s = span("load user");
      s.set("user.id", parseInt(req.path.slice(7)) ?? 0);
      await sleep(1);
      s.end();
    }
    return new Response("ok");
  });
}

async function get(port: i64, path: string, traceparent: string): Promise<string> throws IoError | AbortError {
  let h = new Headers();
  if (traceparent.length > 0) h.set("traceparent", traceparent);
  const res = await fetch("http://127.0.0.1:" + String(port) + path, { headers: h });
  const text = await res.text();
  return path + " gave " + String(res.status) + (text.length > 0 ? " " + text : "");
}

async function main(): Promise<void> throws IoError | AbortError {
  const got = shared({ port: new Atomic(0), posts: new Lock<string[]>([]) });
  spawn(collect(got.clone()));
  while (got.port.load() === 0) await sleep(1);
  // The delay is long enough that only serve's return sends the batch.
  configureTracing({ endpoint: "http://127.0.0.1:" + String(got.port.load()), serviceName: "golden", batchDelay: 5000 });
  const found = shared({ port: new Atomic(0) });
  const ctl = new AbortController();
  const server = spawn(app(found.clone(), ctl.signal, true));
  while (found.port.load() === 0) await sleep(1);
  const port = found.port.load();
  const sampled = await get(port, "/users/7", "00-" + TRACE + "-" + CALLER + "-01");
  console.log(sampled);
  const panicked = await get(port, "/boom", "");
  console.log(panicked);
  const malformed = await get(port, "/plain", "00-" + TRACE + "-" + CALLER);
  console.log(malformed);
  const unsampled = await get(port, "/users/8", "00-" + TRACE + "-" + CALLER + "-00");
  console.log(unsampled);
  ctl.abort();
  await server;
  const posts = got.posts.update((p) => p.splice(0));
  console.log("batches by the time serve returned:", posts.length);
  for (const body of posts) console.log(described(body).trimEnd());

  const quiet = shared({ port: new Atomic(0) });
  const second = new AbortController();
  const untraced = spawn(app(quiet.clone(), second.signal, false));
  while (quiet.port.load() === 0) await sleep(1);
  const plain = await get(quiet.port.load(), "/plain", "");
  console.log(plain);
  second.abort();
  await untraced;
  await flushTraces();
  console.log("batches from a server with trace: false:", got.posts.update((p) => p.length));
}
// case: trace_using
// expect: 1
// expect: caught: no such user
// expect: true true
// expect: early <- nothing
// expect:   stopped: bool true
// expect: failing <- nothing
// expect: inner <- outer
// expect: again <- outer
// expect: outer <- nothing
// A span bound with 'using' ends where its scope does, however the scope is left: at an early
// return, at a throw, and at a block's end, the span around it current again.
import { span, configureTracing, flushTraces } from "fish:trace";

type Sent = { resourceSpans: { scopeSpans: { spans: { spanId: string; parentSpanId?: string; name: string; attributes: { key: string; value: { boolValue?: boolean } }[] }[] }[] }[] };

function early(stop: boolean): i64 {
  using s = span("early");
  s.set("stopped", stop);
  if (stop) return 1;
  return 2;
}

function failing(): void throws Error {
  using s = span("failing");
  throw new Error("no such user");
}

async function nested(): Promise<void> {
  using outer = span("outer");
  await sleep(1);
  let inside = false;
  {
    using inner = span("inner");
    inside = inner.parentSpanId === outer.spanId;
  }
  using again = span("again");
  console.log(inside, again.parentSpanId === outer.spanId);
}

async function collect(got: shared<{ port: Atomic<i64> }>): Promise<void> throws IoError {
  const seen = got.clone();
  await serve({ port: 0, hostname: "127.0.0.1", trace: false, onListen: (info: ServeInfo) => { seen.port.store(info.port); } }, async (req: Request) => {
    const body = await req.text();
    let out = "";
    try {
      const sent = JSON.parse<Sent>(body);
      for (const r of sent.resourceSpans) {
        for (const scope of r.scopeSpans) {
          for (const s of scope.spans) {
            let parent = s.parentSpanId === null ? "nothing" : "a span not in the batch";
            for (const other of scope.spans) if (s.parentSpanId === other.spanId) parent = other.name;
            out += s.name + " <- " + parent + "\n";
            for (const a of s.attributes) out += "  " + a.key + ": bool " + String(a.value.boolValue ?? false) + "\n";
          }
        }
      }
    } catch (e) {
      out = "not the JSON expected: " + body;
    }
    console.log(out.trimEnd());
    return new Response("{}");
  });
}

async function main(): Promise<void> {
  const got = shared({ port: new Atomic(0) });
  spawn(collect(got.clone()));
  while (got.port.load() === 0) await sleep(1);
  configureTracing({ endpoint: "http://127.0.0.1:" + String(got.port.load()), serviceName: "golden", batchDelay: 5000 });
  console.log(early(true));
  try {
    failing();
  } catch (e) {
    console.log("caught:", e.message);
  }
  await nested();
  await flushTraces();
}
// case: trace_sync_main
// expect: main returns
// expect: startup <- nothing
// A program that traces runs on the async runtime, as one that sets timers does, so a main that
// isn't async can still end a span: the batch goes out after main returns. Main can't await the
// stand-in collector, so it polls for it.
import { span, configureTracing } from "fish:trace";

type Sent = { resourceSpans: { scopeSpans: { spans: { parentSpanId?: string; name: string }[] }[] }[] };

declare function usleep(microseconds: u32): i32;

async function collect(got: shared<{ port: Atomic<i64> }>): Promise<void> throws IoError {
  const seen = got.clone();
  await serve({ port: 0, hostname: "127.0.0.1", trace: false, onListen: (info: ServeInfo) => { seen.port.store(info.port); } }, async (req: Request) => {
    const body = await req.text();
    try {
      const sent = JSON.parse<Sent>(body);
      for (const s of sent.resourceSpans[0].scopeSpans[0].spans) console.log(s.name + " <- " + (s.parentSpanId === null ? "nothing" : "a span"));
    } catch (e) {
      console.log("not the JSON expected: " + body);
    }
    return new Response("{}");
  });
}

function main() {
  const got = shared({ port: new Atomic(0) });
  spawn(collect(got.clone()));
  // The collector listens on another worker thread; five seconds is far more than it needs.
  for (let i = 0; i < 5000 && got.port.load() === 0; i++) unsafe { usleep(1000) };
  if (got.port.load() === 0) {
    console.log("the collector never listened");
    return;
  }
  configureTracing({ endpoint: "http://127.0.0.1:" + String(got.port.load()), serviceName: "golden", batchDelay: 10 });
  using s = span("startup");
  console.log("main returns");
}
// case: trace_beside_std_modules
// expect: 200 unset true
// A program with the HTTP library has std's tracing too, beside std modules that declare the C
// functions they call: the environment's and the random source's among them.
import { randomUUID } from "node:crypto";

async function main(): Promise<void> {
  const r = new Response("x");
  console.log(r.status, process.env.FISH_GOLDEN_UNSET ?? "unset", randomUUID().length === 36);
}
