// Deterministic simulation testing: FISH_SIM_SEED single-threaded runtime, virtual clocks,
// seeded PRNG/scheduling, virtual TCP + fault injection (fish:sim), deadlock detection, and
// `fishc test --sim [--seed <n>] [--seeds <count>]`.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fishc, removed, scratch, text } from "./support.fsh";

function write(path: string, contents: string): void {
  try {
    writeFileSync(path, contents);
  } catch (e) {
    assert(false, `can't write ${path}: ${e.message}`);
  }
}

function envWith(extra: [string, string][]): { [name: string]: string } {
  let env: { [name: string]: string } = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k !== "FISH_SIM_SEED" && k !== "FISH_LEAKS") env[k] = v;
  }
  for (const [k, v] of extra) env[k] = v;
  return env;
}

function runBin(bin: string, cwd: string, extra: [string, string][]): { code: i64; out: string; err: string } {
  try {
    const ran = Bun.spawnSync([bin], { cwd, env: envWith(extra), stdout: "pipe", stderr: "pipe" });
    return { code: ran.exitCode ?? -1, out: text(ran.stdout), err: text(ran.stderr) };
  } catch (e) {
    assert(false, `can't run ${bin}: ${e.message}`);
    return { code: -1, out: "", err: "" };
  }
}

test("FISH_SIM_SEED replays concurrent tasks, PRNG, clocks, and virtual TCP identically and explores interleavings across seeds", () => {
  const dir = scratch("fish-sim-replay-");
  try {
    const file = join(dir, "replay.fsh");
    write(
      file,
      `import { enabled, now, seed } from "fish:sim";

async function worker(id: i64, ch: Channel<string>): Promise<void> {
  for (let step = 0; step < 4; step++) {
    await sleep(1);
    const r = Math.floor(Math.random() * 1000);
    await ch.send(\`\${id}:\${step}:\${r}@\${now()}\`);
  }
}

async function echoServer(listener: TcpListener): Promise<void> throws IoError {
  const conn = await listener.accept();
  const req = await conn.read(64);
  await conn.write(req);
}

async function main(): Promise<void> throws IoError {
  console.log("meta", enabled(), seed(), Date.now(), Math.floor(performance.now()));
  const ch = new Channel<string>(32);
  const t1 = spawn(worker(1, ch.clone()));
  const t2 = spawn(worker(2, ch.clone()));
  const t3 = spawn(worker(3, ch.clone()));
  await t1;
  await t2;
  await t3;
  ch.close();
  let items: string[] = [];
  while (true) {
    const v = await ch.receive();
    if (v === null) break;
    items.push(v);
  }
  console.log("trace", items.join(","));

  // Virtual TCP echo over simulated network.
  const listener = await TcpListener.bind("127.0.0.1", 0);
  const port = listener.port;
  const server = spawn(echoServer(listener));
  const client = await TcpStream.connect("127.0.0.1", port);
  await client.write(new TextEncoder().encode("ping-sim"));
  const reply = await client.read(64);
  console.log("tcp", new TextDecoder().decode(reply));
  await server;
}
`,
    );
    const bin = join(dir, "replay");
    const built = fishc(dir, ["build", file, "-o", bin]);
    assert(built.code === 0, `build failed: ${built.err}`);

    // Identical seed produces byte-identical output AND zero leaks under FISH_LEAKS=1.
    const r1 = runBin(bin, dir, [["FISH_SIM_SEED", "42"], ["FISH_LEAKS", "1"]]);
    const r2 = runBin(bin, dir, [["FISH_SIM_SEED", "42"], ["FISH_LEAKS", "1"]]);
    assert(r1.code === 0, `seed 42 run 1 failed: ${r1.err}`);
    assert(r2.code === 0, `seed 42 run 2 failed: ${r2.err}`);
    assert(r1.err === "", `expected 0 leaks on seed 42, got stderr:\n${r1.err}`);
    assert(r1.out === r2.out, `same seed diverged:\n--- run 1 ---\n${r1.out}\n--- run 2 ---\n${r2.out}`);
    assert(r1.out.includes("meta true 42 1704067200000 0"), `unexpected meta line:\n${r1.out}`);
    assert(r1.out.includes("tcp ping-sim"), `missing virtual TCP echo:\n${r1.out}`);

    // Different seed explores a different interleaving/random trace.
    const r3 = runBin(bin, dir, [["FISH_SIM_SEED", "99"]]);
    assert(r3.code === 0, `seed 99 failed: ${r3.err}`);
    assert(r3.out !== r1.out, "expected different trace for different seed");

    // Invalid FISH_SIM_SEED exits cleanly with code 2.
    const bad = runBin(bin, dir, [["FISH_SIM_SEED", "not-a-seed"]]);
    assert(bad.code === 2, `expected exit 2 on bad seed, got ${bad.code}`);
    assert(bad.err.includes("invalid FISH_SIM_SEED"), `expected error message:\n${bad.err}`);
  } finally {
    removed(dir);
  }
}, { timeout: 60_000 });

test("virtual clock advances 60s instantly and virtual network supports delay, partition, and heal", () => {
  const dir = scratch("fish-sim-net-");
  try {
    const file = join(dir, "net.fsh");
    write(
      file,
      `import { advance, heal, now, partition, resetFaults, setDelay } from "fish:sim";

async function serveTwo(listener: TcpListener): Promise<void> throws IoError {
  for (let i = 0; i < 2; i++) {
    const conn = await listener.accept();
    const data = await conn.read(64);
    await conn.write(data);
  }
}

async function main(): Promise<void> throws IoError {
  const t0 = Date.now();
  await sleep(60_000);
  const t1 = Date.now();
  console.log("slept", t1 - t0, now());

  advance(500);
  console.log("advanced", now());

  // Simulated latency and partition/heal on virtual TCP.
  const listener = await TcpListener.bind("10.0.0.1", 8080);
  setDelay(25, 25);
  const server = spawn(serveTwo(listener));

  // Connect 1 succeeds with simulated 25ms one-way latency (connect + write + reply >= 75ms).
  const before = now();
  const c1 = await TcpStream.connect("10.0.0.1", 8080);
  await c1.write(new TextEncoder().encode("hello"));
  const got1 = await c1.read(64);
  const elapsed = now() - before;
  console.log("c1", new TextDecoder().decode(got1), elapsed >= 75);

  // Partition isolates 10.0.0.1:8080 from all peers -> connect fails with EHOSTUNREACH.
  partition("*", "10.0.0.1:8080");
  let partFailed = false;
  try {
    const _blocked = await TcpStream.connect("10.0.0.1", 8080);
  } catch (e) {
    partFailed = e.code === "EHOSTUNREACH";
  }
  console.log("partitioned", partFailed);

  // Heal restores connectivity.
  heal("*", "10.0.0.1:8080");
  resetFaults();
  const c2 = await TcpStream.connect("10.0.0.1", 8080);
  await c2.write(new TextEncoder().encode("healed"));
  const got2 = await c2.read(64);
  console.log("c2", new TextDecoder().decode(got2));
  await server;
}
`,
    );
    const bin = join(dir, "net");
    const built = fishc(dir, ["build", file, "-o", bin]);
    assert(built.code === 0, `build failed: ${built.err}`);

    const wallStart = performance.now();
    const ran = runBin(bin, dir, [["FISH_SIM_SEED", "7"], ["FISH_LEAKS", "1"]]);
    const wallMs = performance.now() - wallStart;
    assert(ran.code === 0, `sim net failed: ${ran.err}`);
    assert(ran.err === "", `expected 0 leaks in sim net, got:\n${ran.err}`);
    assert(wallMs < 5000, `expected 60s virtual sleep to finish instantly, took ${wallMs}ms`);
    const out = ran.out;
    assert(out.includes("slept 60000 60000"), `unexpected sleep output:\n${out}`);
    assert(out.includes("advanced 60500"), `unexpected advance output:\n${out}`);
    assert(out.includes("c1 hello true"), `unexpected latency/echo output:\n${out}`);
    assert(out.includes("partitioned true"), `expected EHOSTUNREACH under partition:\n${out}`);
    assert(out.includes("c2 healed"), `expected healed echo:\n${out}`);
  } finally {
    removed(dir);
  }
}, { timeout: 60_000 });

test("simulation detects deadlocks loudly naming the seed", () => {
  const dir = scratch("fish-sim-deadlock-");
  try {
    const file = join(dir, "deadlock.fsh");
    write(
      file,
      `async function waitForever(ch: Channel<i64>): Promise<void> {
  const v = await ch.receive();
  console.log(v);
}

async function main() {
  const ch = new Channel<i64>(1);
  // Keep ch open while awaiting waiter so neither task can progress.
  const waiter = spawn(waitForever(ch.clone()));
  await waiter;
  await ch.send(1);
}
`,
    );
    const bin = join(dir, "deadlock");
    const built = fishc(dir, ["build", file, "-o", bin]);
    assert(built.code === 0, `build failed: ${built.err}`);
    const ran = runBin(bin, dir, [["FISH_SIM_SEED", "777"]]);
    assert(ran.code === 101, `expected deadlock exit 101, got ${ran.code}`);
    assert(ran.err.includes("fish sim deadlock (seed 777)"), `expected seed in deadlock diagnostic:\n${ran.err}`);
  } finally {
    removed(dir);
  }
}, { timeout: 60_000 });

test("fishc test --sim --seeds finds a concurrency race and --seed replays it deterministically", () => {
  const dir = scratch("fish-sim-test-");
  try {
    write(join(dir, "fish.toml"), `[package]\nname = "simrace"\nversion = "0.1.0"\n`);
    write(
      join(dir, "race.fsh"),
      `import { enabled } from "fish:sim";

async function sendTag(ch: Channel<string>, tag: string): Promise<void> {
  await sleep(1);
  await ch.send(tag);
}

test("concurrent order race", async () => {
  assert(enabled(), "expected sim mode enabled");
  const ch = new Channel<string>(4);
  const a = spawn(sendTag(ch.clone(), "A"));
  const b = spawn(sendTag(ch.clone(), "B"));
  await a;
  await b;
  const raw = await ch.receive();
  const first = raw ?? "";
  // Fails whenever B runs before A.
  assert(first === "A", \`race: got \${first} first\`);
});
`,
    );
    // Running 16 seeds must hit both A-first (pass) and B-first (FAIL with seed tag).
    const sweep = fishc(dir, ["test", "--sim", "--seed", "1", "--seeds", "16"]);
    assert(sweep.code === 1, `expected sweep to catch race, got exit ${sweep.code}:\n${sweep.out}\n${sweep.err}`);
    const lines = sweep.out.split("\n");
    let failSeed = "";
    let passSeed = "";
    for (const line of lines) {
      const m = /\(seed ([0-9]+)\)/.exec(line);
      if (m === null) continue;
      if (line.startsWith("FAIL ") && failSeed === "") failSeed = m[1]!;
      if (line.startsWith("ok ") && passSeed === "") passSeed = m[1]!;
    }
    assert(failSeed !== "", `expected a failing seed in output:\n${sweep.out}\n${sweep.err}`);
    assert(passSeed !== "", `expected a passing seed in output:\n${sweep.out}\n${sweep.err}`);

    // Replaying the failing seed reproduces the failure deterministically.
    const replayFail = fishc(dir, ["test", "--sim", "--seed", failSeed]);
    assert(replayFail.code === 1, `expected replay of failing seed ${failSeed} to fail:\n${replayFail.out}`);
    assert(replayFail.out.includes(`(seed ${failSeed})`), `missing seed tag on replay:\n${replayFail.out}`);

    // Replaying the passing seed passes deterministically.
    const replayPass = fishc(dir, ["test", "--sim", "--seed", passSeed]);
    assert(replayPass.code === 0, `expected replay of passing seed ${passSeed} to pass:\n${replayPass.out}`);

    // Guard: --seed without --sim is rejected.
    const bad = fishc(dir, ["test", "--seed", "1"]);
    assert(bad.code === 2, `expected exit 2 for --seed without --sim, got ${bad.code}`);
  } finally {
    removed(dir);
  }
}, { timeout: 60_000 });

test("virtual HTTP serve/fetch and setDropRate work deterministically with zero leaks", () => {
  const dir = scratch("fish-sim-http-");
  try {
    const file = join(dir, "http.fsh");
    write(
      file,
      `import { resetFaults, setDropRate } from "fish:sim";

async function main(): Promise<void> throws Error | IoError | AbortError {
  const ctl = new AbortController();
  const found = shared({ port: new Atomic(0) });
  const seen = found.clone();
  const srv = spawn(serve(
    {
      hostname: "127.0.0.1",
      port: 0,
      signal: ctl.signal,
      onListen: (info: ServeInfo) => {
        seen.port.store(info.port);
      },
    },
    async (req: Request): Promise<Response> => new Response("sim-ok:" + req.url),
  ));
  while (found.port.load() === 0) await sleep(1);
  const port = found.port.load();
  const url = \`http://localhost:\${port}/hello\`;
  const resp = await fetch(url);
  const body = await resp.text();
  console.log("http", resp.status, body);

  // Drop rate 1.0 causes virtual connect to fail with ECONNRESET.
  setDropRate(1.0);
  let dropped = false;
  try {
    const _c = await TcpStream.connect("127.0.0.1", port);
  } catch (e) {
    dropped = e.code === "ECONNRESET";
  }
  resetFaults();
  console.log("dropped", dropped);

  ctl.abort();
  await srv;
}
`,
    );
    const bin = join(dir, "http");
    const built = fishc(dir, ["build", file, "-o", bin]);
    assert(built.code === 0, `http build failed: ${built.err}`);
    const ran = runBin(bin, dir, [["FISH_SIM_SEED", "123"], ["FISH_LEAKS", "1"]]);
    assert(ran.code === 0, `sim http failed: ${ran.err}`);
    assert(ran.err === "", `expected 0 leaks in sim http, got:\n${ran.err}`);
    assert(ran.out.includes("http 200 sim-ok:http://localhost:10000/hello"), `unexpected HTTP response:\n${ran.out}`);
    assert(ran.out.includes("dropped true"), `expected ECONNRESET under dropRate=1.0:\n${ran.out}`);
  } finally {
    removed(dir);
  }
}, { timeout: 60_000 });

test("simulation supports AbortSignal.timeout, setTimeout drain, spawnBlocking, and rejects UDP/Unix cleanly", () => {
  const dir = scratch("fish-sim-edge-");
  try {
    const file = join(dir, "edge.fsh");
    write(
      file,
      `import { now } from "fish:sim";

async function main(): Promise<void> throws IoError | AbortError {
  // AbortSignal.timeout cancels virtual accept cleanly with zero leaks.
  const listener = await TcpListener.bind("0.0.0.0", 0);
  let aborted = false;
  try {
    const _conn = await listener.accept(AbortSignal.timeout(50));
  } catch (e) {
    aborted = e instanceof AbortError;
  }
  console.log("aborted", aborted, now());

  // spawnBlocking runs deterministically on the single simulation thread.
  const bh = spawnBlocking(() => 21 * 2);
  const val = await bh;
  console.log("blocking", val);

  // UDP and Unix sockets fail fast with ENOTSUP instead of deadlocking.
  let udpErr = "";
  try {
    const _u = await UdpSocket.bind("127.0.0.1", 0);
  } catch (e) {
    udpErr = e.code;
  }
  let unixErr = "";
  try {
    const _x = await UnixListener.bind("/tmp/fish-sim-unused.sock");
  } catch (e) {
    unixErr = e.code;
  }
  console.log("unsupported", udpErr, unixErr);

  // Phase 2 setTimeout drains after main returns via virtual clock.
  setTimeout(() => {
    console.log("timeout-fired", now());
  }, 5000);
}
`,
    );
    const bin = join(dir, "edge");
    const built = fishc(dir, ["build", file, "-o", bin]);
    assert(built.code === 0, `edge build failed: ${built.err}`);
    const ran = runBin(bin, dir, [["FISH_SIM_SEED", "55"], ["FISH_LEAKS", "1"]]);
    assert(ran.code === 0, `sim edge failed: ${ran.err}`);
    assert(ran.err === "", `expected 0 leaks in sim edge, got:\n${ran.err}`);
    assert(ran.out.includes("aborted true 50"), `unexpected abort output:\n${ran.out}`);
    assert(ran.out.includes("blocking 42"), `unexpected blocking output:\n${ran.out}`);
    assert(ran.out.includes("unsupported ENOTSUP ENOTSUP"), `expected ENOTSUP for UDP/Unix:\n${ran.out}`);
    assert(ran.out.includes("timeout-fired 5050"), `expected virtual setTimeout drain:\n${ran.out}`);

    // Overflow guard on --seed + --seeds.
    write(join(dir, "fish.toml"), `[package]\nname = "simovf"\nversion = "0.1.0"\n`);
    const ovf = fishc(dir, ["test", "--sim", "--seed", "18446744073709551615", "--seeds", "2"]);
    assert(ovf.code === 2, `expected exit 2 on u64 seed overflow, got ${ovf.code}`);
  } finally {
    removed(dir);
  }
}, { timeout: 60_000 });
