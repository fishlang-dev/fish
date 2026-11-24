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
  await serve({ port: 0, hostname: "127.0.0.1", onListen: (info: ServeInfo) => { seen.port.store(info.port); } }, async (_req: Request) => new Response("{}"));
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
  await serve({ port: 0, hostname: "127.0.0.1", onListen: (info: ServeInfo) => { seen.port.store(info.port); } }, async (req: Request) => {
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
