// case: inspect_sync_empty
// expect: 0
// expect: []
// expect: no live tasks
import { tasks, tasksJson, formatTasks } from "fish:inspect";

function main(): void {
  console.log(tasks().length);
  console.log(tasksJson());
  console.log(formatTasks().trim());
}

// case: inspect_live_states_and_awaits
// expect: main ok
// expect: sleeper ok
// expect: receiver ok
// expect: joiner ok
// expect: blocker ok
// expect: table ok
import { tasks, formatTasks, type TaskInfo } from "fish:inspect";

async function sleeper(ready: Channel<i64>): Promise<void> {
  await ready.send(1);
  await sleep(5000);
}

async function receiver(ready: Channel<i64>, gate: Channel<i64>): Promise<void> {
  await ready.send(1);
  await gate.receive();
}

async function targetTask(ready: Channel<i64>, gate: Channel<i64>): Promise<void> {
  await ready.send(1);
  await gate.receive();
}

async function joiner(ready: Channel<i64>, handle: JoinHandle<void>): Promise<void> {
  await ready.send(1);
  await handle;
}

function findTask(list: Ref<TaskInfo[]>, name: string): TaskInfo | null {
  for (const t of list) if (t.name === name) return t.clone();
  return null;
}

type BlockFlags = { entered: Atomic<boolean>; release: Atomic<boolean> };

async function main(): Promise<void> {
  const ready = new Channel<i64>(8);
  const gate = new Channel<i64>(1);
  const flags = shared<BlockFlags>({ entered: new Atomic(false), release: new Atomic(false) });

  const _s = spawn(sleeper(ready.clone()));
  const _r = spawn(receiver(ready.clone(), gate.clone()));
  const target = spawn(targetTask(ready.clone(), gate.clone()));
  const _j = spawn(joiner(ready.clone(), target));
  const bf = flags.clone();
  const blocker = spawnBlocking(() => {
    bf.entered.store(true);
    while (!bf.release.load()) {
      let x = 0;
      for (let i = 0; i < 1000; i++) x += i;
    }
    return 1;
  });

  for (let i = 0; i < 4; i++) await ready.receive();
  while (!flags.entered.load()) await sleep(2);
  await sleep(25);

  const list = tasks();
  const mainT = findTask(list, "main");
  const sleepT = findTask(list, "sleeper");
  const recvT = findTask(list, "receiver");
  const targetT = findTask(list, "targetTask");
  const joinT = findTask(list, "joiner");
  let blockT: TaskInfo | null = null;
  for (const t of list) if (t.blocking) blockT = t.clone();

  if (mainT !== null && mainT!.id === 1 && mainT!.state === "running" && !mainT!.blocking && mainT!.polls >= 1) {
    console.log("main ok");
  }
  if (
    sleepT !== null &&
    sleepT!.state === "waiting" &&
    sleepT!.awaiting === "sleep" &&
    sleepT!.spawnSite.includes("inspect_live_states_and_awaits.fsh:") &&
    sleepT!.awaitSite.includes("inspect_live_states_and_awaits.fsh:") &&
    sleepT!.ageMs >= 10
  ) {
    console.log("sleeper ok");
  }
  if (
    recvT !== null &&
    recvT!.state === "waiting" &&
    recvT!.awaiting === "channel.receive" &&
    recvT!.spawnSite.includes("inspect_live_states_and_awaits.fsh:")
  ) {
    console.log("receiver ok");
  }
  if (
    joinT !== null &&
    targetT !== null &&
    joinT!.state === "waiting" &&
    joinT!.awaiting === `join #${targetT!.id}` &&
    joinT!.spawnSite.includes("inspect_live_states_and_awaits.fsh:")
  ) {
    console.log("joiner ok");
  }
  if (blockT !== null && blockT!.blocking && blockT!.spawnSite.includes("inspect_live_states_and_awaits.fsh:")) {
    console.log("blocker ok");
  }

  const table = formatTasks();
  if (table.includes("ID") && table.includes("AWAITING") && table.includes("sleeper") && table.includes("channel.receive")) {
    console.log("table ok");
  }

  flags.release.store(true);
  gate.close();
  await blocker;
}

// case: inspect_release_keeps_names_and_spawn_sites
// mode: release
// expect: ok
import { tasks, type TaskInfo } from "fish:inspect";

async function worker(ready: Channel<i64>, gate: Channel<i64>): Promise<void> {
  await ready.send(1);
  await gate.receive();
}

async function main(): Promise<void> {
  const ready = new Channel<i64>(2);
  const gate = new Channel<i64>(1);
  const h = spawn(worker(ready.clone(), gate.clone()));
  await ready.receive();
  await sleep(15);
  let found: TaskInfo | null = null;
  for (const t of tasks()) if (t.name === "worker") found = t.clone();
  if (
    found !== null &&
    found!.state === "waiting" &&
    found!.awaiting === "channel.receive" &&
    found!.spawnSite.includes("inspect_release_keeps_names_and_spawn_sites.fsh:") &&
    found!.ageMs >= 5
  ) {
    console.log("ok");
  }
  gate.close();
  await h;
}

// case: inspect_group_semaphore_and_tcp
// expect: group ok
// expect: sem ok
// expect: tcp ok
import { tasks, type TaskInfo } from "fish:inspect";

type SemBox = { sem: Semaphore };

async function semWaiter(ready: Channel<i64>, box: shared<SemBox>): Promise<void> {
  await ready.send(1);
  const _p = await box.sem.acquire();
}

async function groupRunner(ready: Channel<i64>, gate: Channel<i64>): Promise<void> {
  await taskGroup(async (g) => {
    g.spawn(async () => {
      await ready.send(1);
      await gate.receive();
    });
  });
}

async function acceptWaiter(ready: Channel<i64>, listener: TcpListener): Promise<void> {
  await ready.send(1);
  try {
    const _c = await listener.accept();
  } catch (_e) {}
}

function byName(list: Ref<TaskInfo[]>, name: string): TaskInfo | null {
  for (const t of list) if (t.name === name) return t.clone();
  return null;
}

function releasePermit(_p: Permit): void {}
function releaseConn(_c: TcpStream): void {}

async function main(): Promise<void> throws IoError {
  const ready = new Channel<i64>(4);
  const gate = new Channel<i64>(1);
  const sem = shared<SemBox>({ sem: new Semaphore(1) });
  const held = await sem.sem.acquire();
  const listener = await TcpListener.bind("127.0.0.1", 0);
  const port = listener.port;

  const hGroup = spawn(groupRunner(ready.clone(), gate.clone()));
  const hSem = spawn(semWaiter(ready.clone(), sem.clone()));
  const hTcp = spawn(acceptWaiter(ready.clone(), listener));

  for (let i = 0; i < 3; i++) await ready.receive();
  await sleep(20);

  const list = tasks();
  const gT = byName(list, "groupRunner");
  const sT = byName(list, "semWaiter");
  const tT = byName(list, "acceptWaiter");

  if (gT !== null && gT!.state === "waiting" && gT!.awaiting === "task_group") console.log("group ok");
  if (sT !== null && sT!.state === "waiting" && sT!.awaiting === "semaphore") console.log("sem ok");
  if (tT !== null && tT!.state === "waiting" && tT!.awaiting === "tcp.accept") console.log("tcp ok");

  gate.close();
  releasePermit(held);
  const conn = await TcpStream.connect("127.0.0.1", port);
  releaseConn(conn);
  await hGroup;
  await hSem;
  await hTcp;
}

// case: inspect_http_server
// expect: json ok
// expect: text ok
// expect: html ok
// expect: 404 ok
// expect: child exit 0
import { type TaskInfo } from "fish:inspect";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function heldWorker(ready: Channel<i64>, gate: Channel<i64>): Promise<void> {
  await ready.send(1);
  await gate.receive();
}

function closeConn(_c: TcpStream): void {}

async function childMain(): Promise<void> throws IoError {
  const ready = new Channel<i64>(2);
  const gate = new Channel<i64>(1);
  const stop = await TcpListener.bind("127.0.0.1", 0);
  const h = spawn(heldWorker(ready.clone(), gate.clone()));
  await ready.receive();
  await sleep(15);
  const readyPort = parseInt(process.env.READY_PORT ?? "0", 10) ?? 0;
  const notify = await TcpStream.connect("127.0.0.1", readyPort);
  await notify.write(new TextEncoder().encode(`${stop.port}\n`));
  closeConn(notify);
  const _conn = await stop.accept();
  gate.close();
  await h;
}

async function main(): Promise<void> throws IoError | AbortError | JsonError | Error {
  if (process.env.INSPECT_CHILD === "1") {
    await childMain();
    return;
  }
  const errFile = join(tmpdir(), `fish-inspect-test-${process.pid}.err`);
  const readyListener = await TcpListener.bind("127.0.0.1", 0);
  const env: { [name: string]: string } = {
    INSPECT_CHILD: "1",
    FISH_INSPECT: "127.0.0.1:0",
    FISH_LEAKS: "1",
    READY_PORT: `${readyListener.port}`,
  };
  const child = Bun.spawn(["sh", "-c", 'exec "$1" 2>"$2"', "_", process.execPath, errFile], { env, stdout: "pipe", stderr: "pipe" });

  const peer = await readyListener.accept();
  const raw = await peer.read(64);
  const msg = new TextDecoder().decode(raw).trim();
  const stopPort = parseInt(msg, 10) ?? 0;
  closeConn(peer);
  await sleep(15);

  const errText = readFileSync(errFile, "utf8");
  let inspectUrl = "";
  const prefix = "fish inspector listening on ";
  for (const line of errText.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith(prefix)) {
      inspectUrl = trimmed.slice(prefix.length as i64);
      break;
    }
  }

  const rJson = await fetch(`${inspectUrl}/tasks.json`);
  const jsonBody = await rJson.text();
  const parsed = JSON.parse<TaskInfo[]>(jsonBody);
  let sawWorker = false;
  let sawMain = false;
  for (const t of parsed) {
    if (t.name === "heldWorker" && t.state === "waiting" && t.awaiting === "channel.receive" && t.spawnSite.includes("inspect_http_server.fsh:")) sawWorker = true;
    if (t.name === "main" && t.awaiting === "tcp.accept") sawMain = true;
  }
  if (rJson.status === 200 && sawWorker && sawMain) console.log("json ok");

  const rText = await fetch(`${inspectUrl}/tasks`);
  const txt = await rText.text();
  if (rText.status === 200 && txt.includes("heldWorker") && txt.includes("channel.receive")) console.log("text ok");

  const rHtml = await fetch(`${inspectUrl}/`);
  const html = await rHtml.text();
  if (rHtml.status === 200 && html.includes("Fish Task Inspector") && html.includes("heldWorker") && html.includes("<table")) console.log("html ok");

  const r404 = await fetch(`${inspectUrl}/missing`);
  if (r404.status === 404) console.log("404 ok");

  const wake = await TcpStream.connect("127.0.0.1", stopPort);
  closeConn(wake);
  const code = await child.exited;
  const finalErr = readFileSync(errFile, "utf8");
  rmSync(errFile, { force: true });
  if (finalErr.includes("leaked")) console.log(`LEAKED: ${finalErr}`);
  console.log(`child exit ${code}`);
}

// case: inspect_invalid_env
// expect: warn ok
// expect: exit 0
async function main(): Promise<void> throws IoError {
  if (process.env.INSPECT_BAD === "1") {
    await sleep(1);
    return;
  }
  const r = Bun.spawnSync([process.execPath], { env: { INSPECT_BAD: "1", FISH_INSPECT: "not-an-addr" } });
  const err = new TextDecoder().decode(r.stderr);
  if (err.includes("fish inspector: invalid FISH_INSPECT")) console.log("warn ok");
  console.log(`exit ${r.exitCode ?? -1}`);
}
