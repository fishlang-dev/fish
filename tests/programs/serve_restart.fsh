// case: serve_restart
// expect: first
// expect: second, with no request refused
// expect: the first process drained
// SIGUSR2 starts the program again on the server's listener: the new process says it listens,
// the old one stops accepting and drains, and requests reach the new one with none refused. The
// marker file, named by the port both share, tells the second process apart from the first.
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

async function main(): Promise<void> throws IoError | AbortError {
  const state = shared({ port: new Atomic(0), second: new Atomic(0) });
  const seen = state.clone();
  const told = state.clone();
  const ctl = new AbortController();
  const stop = ctl.signal;
  const server = spawn(serve({ port: 0, hostname: "127.0.0.1", restart: true, signal: stop, onListen: (info: ServeInfo) => {
    const marker = tmpdir() + "/fish-serve-restart-" + String(info.port);
    if (existsSync(marker)) seen.second.store(1);
    else {
      try {
        writeFileSync(marker, "first");
      } catch (e) {
        console.log("can't write the marker: " + e.message);
      }
    }
    seen.port.store(info.port);
  } }, async (req: Request) => {
    if (told.second.load() === 0) return new Response("first");
    if (req.path === "/stop") {
      try {
        unlinkSync(tmpdir() + "/fish-serve-restart-" + String(told.port.load()));
      } catch (e) {
        console.log("can't remove the marker: " + e.message);
      }
      ctl.abort();
      return new Response("bye");
    }
    return new Response("second");
  }));
  while (state.port.load() === 0) await sleep(5);
  // The second process only serves, then ends at /stop.
  if (state.second.load() === 1) {
    await server;
    return;
  }
  const url = "http://127.0.0.1:" + String(state.port.load());
  const before = await fetch(url);
  const said = await before.text();
  console.log(said);
  process.kill(process.pid, "SIGUSR2");
  let refused = 0;
  let answer = "";
  for (let i = 0; i < 1000 && answer !== "second"; i++) {
    try {
      const res = await fetch(url);
      answer = await res.text();
    } catch (e) {
      refused++;
    }
    await sleep(10);
  }
  console.log(answer + ", with " + (refused === 0 ? "no request" : String(refused) + " requests") + " refused");
  await server;
  console.log("the first process drained");
  const bye = await fetch(url + "/stop");
  await bye.text();
}
