// expect: ping: PONG
// expect: set: OK get: v missing: null
// expect: nx: null ex: OK ttl: 10
// expect: incr: 1 2 7 6
// expect: del: 2 exists: false expire: false
// expect: error: WRONGTYPE WRONGTYPE Operation against a key holding the wrong kind of value
// expect: raw: 3
// expect: pooled: 20
// expect: auth: ok wrong: WRONGPASS
// expect: news: first
// expect: news: second
// expect: bad url: a Redis URL starts with redis:// or rediss://, not http:
// std:redis against a small RESP server in fake.fsh: commands on a pool of connections, an
// error reply thrown as RedisError, AUTH from the URL, and publish and subscribe.
import { createClient, RedisClient, RedisError } from "std:redis";
import { fakeRedis } from "./fake.fsh";

async function bump(client: RedisClient): Promise<i64> {
  try {
    const n = await client.incr("p");
    return n;
  } catch (e) {
    return -1;
  }
}

async function listenFor(client: RedisClient, out: Channel<string>): Promise<void> throws RedisError | IoError | AbortError {
  for await (const m of client.subscribe("news")) await out.send(m.channel + ": " + m.message);
}

async function main(): Promise<void> throws IoError | AbortError | RedisError | TypeError | TaskPanic {
  const port = await fakeRedis();
  const base = "127.0.0.1:" + String(port);
  const client = createClient({ url: "redis://" + base, poolSize: 4 });
  await client.connect();
  const pong = await client.ping();
  console.log("ping:", pong);
  const set = await client.set("k", "v");
  const got = await client.get("k");
  const missing = await client.get("nope");
  console.log("set:", set, "get:", got, "missing:", missing);
  const nx = await client.set("k", "w", { NX: true });
  const ex = await client.set("t", "x", { EX: 10 });
  const ttl = await client.ttl("t");
  console.log("nx:", nx, "ex:", ex, "ttl:", ttl);
  const a = await client.incr("n");
  const b = await client.incr("n");
  const c = await client.incrBy("n", 5);
  const d = await client.decr("n");
  console.log("incr:", a, b, c, d);
  const raw = await client.sendCommand(["RPUSH", "list", "a", "b", "c"]);
  const deleted = await client.del(["k", "t", "none"]);
  const exists = await client.exists("k");
  const expired = await client.expire("k", 5);
  console.log("del:", deleted, "exists:", exists, "expire:", expired);
  try {
    await client.incr("list");
  } catch (e) {
    if (e instanceof RedisError) console.log("error:", e.code, e.message);
  }
  console.log("raw:", raw);
  let tasks: JoinHandle<i64>[] = [];
  for (let i = 0; i < 20; i++) tasks.push(spawn(bump(client.clone())));
  while (tasks.length > 0) {
    const t = tasks.pop()!;
    await t.join();
  }
  const pooled = await client.get("p");
  console.log("pooled:", pooled);
  const authed = createClient({ url: "redis://:secret@" + base });
  const fine = await authed.ping();
  let wrong = "none";
  try {
    const refused = createClient({ url: "redis://:nope@" + base });
    await refused.ping();
  } catch (e) {
    if (e instanceof RedisError) wrong = e.code;
  }
  console.log("auth:", fine === "PONG" ? "ok" : fine, "wrong:", wrong);
  const heard = new Channel<string>(4);
  spawn(listenFor(client.clone(), heard.clone()));
  // The subscriber is listening once a publish reaches one.
  while (true) {
    const reached = await client.publish("news", "first");
    if (reached > 0) break;
    await sleep(5);
  }
  await client.publish("news", "second");
  for (let i = 0; i < 2; i++) {
    const line = await heard.receive();
    if (line !== null) console.log(line);
  }
  try {
    createClient({ url: "http://x" });
  } catch (e) {
    console.log("bad url:", e.message);
  }
}
