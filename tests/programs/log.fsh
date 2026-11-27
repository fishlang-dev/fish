// case: log_levels
// expect: done
// std:log writes to stderr only, with fields or without, at every level.
import * as log from "std:log";
type Hit = { user: string; n: i64 };
function main() {
  log.debug("hidden");
  log.info("started");
  log.warn("slow", { ms: 12 });
  const hit: Hit = { user: "ann", n: 2 };
  log.error("failed", hit);
  console.log("done");
}
// case: log_request_id
// expect: 200 abc-1
// expect: 200 16
// serve takes a request's x-request-id, or makes one of 16 hex digits, and echoes it.
import * as log from "std:log";
async function get(port: i64, id: string | null): Promise<void> throws IoError | AbortError {
  let headers = new Headers();
  if (id !== null) headers.set("x-request-id", id);
  const res = await fetch("http://127.0.0.1:" + String(port) + "/", { headers });
  const echoed = res.headers.get("x-request-id") ?? "";
  console.log(res.status, id !== null ? echoed : String(echoed.length));
}
async function main(): Promise<void> throws IoError | AbortError {
  let app = new Router();
  app.get("/", async (_req) => {
    await sleep(1);
    log.info("served");
    return new Response("ok");
  });
  const found = shared({ port: new Atomic(0) });
  const seen = found.clone();
  spawn(serve({ port: 0, hostname: "127.0.0.1", onListen: (info) => { seen.port.store(info.port); } }, app.handler()));
  while (found.port.load() === 0) await sleep(1);
  const port = found.port.load();
  await get(port, "abc-1");
  await get(port, null);
}
