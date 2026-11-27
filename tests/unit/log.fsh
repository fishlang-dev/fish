// std:log's lines on stderr: the level filter, fields and the request ID serve gives each task.
import { spawnSync } from "node:child_process";
import { built, removed, same, scratch, text } from "./support.fsh";

const PROGRAM = `import * as log from "std:log";
type Hit = { user: string; n: i64 };
async function child(): Promise<void> {
  log.info("child");
}
async function main(): Promise<void> throws IoError | AbortError {
  log.debug("quiet");
  log.info("plain");
  log.warn("list", [1, 2]);
  const hit: Hit = { user: "ann", n: 2 };
  log.error("hit", hit);
  let app = new Router();
  app.get("/", async (_req) => {
    await sleep(1);
    const inner = spawn(child());
    await inner;
    log.info("served", { path: "/" });
    return new Response("ok");
  });
  const found = shared({ port: new Atomic(0) });
  const seen = found.clone();
  spawn(serve({ port: 0, hostname: "127.0.0.1", onListen: (info) => { seen.port.store(info.port); } }, app.handler()));
  while (found.port.load() === 0) await sleep(1);
  let headers = new Headers();
  headers.set("x-request-id", "req-7");
  const res = await fetch("http://127.0.0.1:" + String(found.port.load()) + "/", { headers });
  console.log(res.headers.get("x-request-id") ?? "");
}
`;

// Each line with its timestamp checked and taken out, so the rest compares exactly.
function lines(stderr: string): string[] {
  let out: string[] = [];
  for (const line of stderr.trim().split("\n")) {
    const at = line.indexOf("\"ts\":\"");
    assert(line.startsWith("{\"ts\":\"") && line.slice(at + 6, at + 30).endsWith("Z"), `a timestamped line: ${line}`);
    out.push("{" + line.slice(at + 32));
  }
  return out;
}

test("std:log writes JSON lines at FISH_LOG's level and up, with the request ID inside serve", () => {
  const dir = scratch("fish-log-");
  const out = built(dir, "main", PROGRAM);
  const plain = spawnSync(out, []);
  same(text(plain.stdout), "req-7\n", "stdout");
  same(lines(text(plain.stderr)).join("\n"), [
    "{\"level\":\"info\",\"msg\":\"plain\"}",
    "{\"level\":\"warn\",\"msg\":\"list\",\"fields\":[1,2]}",
    "{\"level\":\"error\",\"msg\":\"hit\",\"n\":2,\"user\":\"ann\"}",
    "{\"level\":\"info\",\"msg\":\"child\",\"requestId\":\"req-7\"}",
    "{\"level\":\"info\",\"msg\":\"served\",\"requestId\":\"req-7\",\"path\":\"/\"}",
  ].join("\n"), "stderr at info");
  const loud = spawnSync("env", ["FISH_LOG=debug", out]);
  same(lines(text(loud.stderr))[0]!, "{\"level\":\"debug\",\"msg\":\"quiet\"}", "the first line at debug");
  const quiet = spawnSync("env", ["FISH_LOG=error", out]);
  same(String(lines(text(quiet.stderr)).length), "1", "lines at error");
  removed(dir);
}, { timeout: 60_000 });
