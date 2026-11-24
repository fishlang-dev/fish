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
