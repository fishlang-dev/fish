// Ports tests/postgres.test.ts: the postgres module against a scripted server speaking Postgres's
// wire protocol, run by Bun as a child process in the background, and against a throwaway Postgres
// when one is installed. Each scripted server takes its script as JavaScript, writes its URL once it
// listens, and at SIGTERM writes what it saw: the statements, its connection counts, and any
// protocol rule the client broke.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { built, fishc, freePort, removed, root, same, scratch, text } from "./support.fsh";

function write(path: string, contents: string): void {
  try {
    writeFileSync(path, contents);
  } catch (e) {
    assert(false, `can't write ${path}: ${e.message}`);
  }
}

function readText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    assert(false, `can't read ${path}: ${e.message}`);
    return "";
  }
}

// Waits up to five seconds for `path` to exist.
function awaited(path: string): void {
  spawnSync("sh", ["-c", `n=0; while [ ! -e "$1" ] && [ $n -lt 100 ]; do sleep 0.05; n=$((n + 1)); done`, "sh", path]);
}

// Runs `binary` with `args`, FISH_LEAKS set; its stderr must be empty and its exit code 0.
function ran(binary: string, args: string[]): string {
  const run = spawnSync("env", ["FISH_LEAKS=1", binary, ...args]);
  same(text(run.stderr), "", `${binary}'s stderr`);
  assert(run.status === 0, `${binary} exited with ${run.status ?? -1}`);
  return text(run.stdout);
}

// Connects to the URL it's given and prints a row, or the error that stopped it.
function auth(): string {
  return `import { Pool, PostgresError, RowError } from "postgres";

async function main(): Promise<void> {
  try {
    const pool = await Pool.connect(process.argv[2]);
    const row = await pool.queryOne<{ who: string }>("select current_user as who");
    if (row !== null) console.log("connected as", row.who);
  } catch (e) {
    if (e instanceof PostgresError) console.log("PostgresError", e.code, e.message);
    else if (e instanceof IoError) console.log("IoError", e.message);
    else console.log("other", e.message);
  }
}
`;
}

// Every kind of value through one statement, then a server error, a broken connection, a failed
// transaction and an empty result, each followed by a statement that shows the pool went on.
function queries(): string {
  return `import { Pool, PostgresError, RowError, SqlValue } from "postgres";

type Row = { id: i64; name: string; note: string | null; ok: boolean; score: f64; small: i16; raw: u8[]; doc: Json; price: string };

async function main(): Promise<void> throws IoError | AbortError | TypeError | PostgresError | RowError {
  const pool = await Pool.connect(process.argv[2]);
  const bytes: u8[] = [0, 255];
  const params: SqlValue[] = [7, "it's", null, true, 2.5, bytes, new Date(0), 9007199254740993];
  const rows = await pool.query<Row>("select everything", params.clone());
  for (const r of rows) console.log(r.id, r.name, r.note, r.ok, r.score, r.small, r.raw, JSON.stringify(r.doc), r.price);
  try {
    await pool.execute("fail");
  } catch (e) {
    if (e instanceof PostgresError) console.log("PostgresError", e.code, e.message, e.detail, e.severity);
  }
  const updated = await pool.execute("update", [1]);
  console.log("updated", updated);
  try {
    await pool.execute("break");
  } catch (e) {
    if (e instanceof IoError) console.log("IoError", e.message);
  }
  try {
    await pool.execute("fail in transaction");
  } catch (e) {
    if (e instanceof PostgresError) console.log("PostgresError", e.code);
  }
  const after = await pool.execute("after");
  console.log("after", after);
  const none = await pool.queryOne<Row>("empty");
  console.log("none", none === null);
  try {
    await pool.query<{ id: i64; missing: string }>("select everything", params);
  } catch (e) {
    if (e instanceof RowError) console.log("RowError", e.message);
  }
}
`;
}

// Many tasks sharing one pool of the URL's size.
function concurrent(): string {
  return `import { Pool, PostgresError } from "postgres";

async function one(pool: Pool, i: i64): Promise<i64> {
  try {
    const row = await pool.queryOne<{ n: i64 }>("slow", [i]);
    return row === null ? -1 : row.n;
  } catch (e) {
    console.log("failed", e.message);
    return -1000;
  }
}

async function main(): Promise<void> throws IoError | AbortError | TypeError | PostgresError {
  const pool = await Pool.connect(process.argv[2]);
  let handles: JoinHandle<i64>[] = [];
  for (let i: i64 = 1; i <= 6; i++) handles.push(spawn(one(pool.clone(), i)));
  let sum: i64 = 0;
  while (handles.length > 0) {
    const h = handles.pop()!;
    const n = await h;
    sum += n;
  }
  console.log("sum", sum);
}
`;
}

// A COPY FROM STDIN, then a statement on the same connection.
function copy(): string {
  return `import { Pool, PostgresError } from "postgres";

async function main(): Promise<void> throws IoError | AbortError | TypeError | PostgresError {
  const pool = await Pool.connect(process.argv[2]);
  try {
    await pool.execute("copy");
  } catch (e) {
    if (e instanceof PostgresError) console.log("PostgresError", e.code, e.message);
  }
  const after = await pool.execute("after");
  console.log("after", after);
}
`;
}

// The build's stderr and exit code for `entry` in `dir`.
function refusal(dir: string, entry: string): string {
  const run = fishc(dir, ["build", join(dir, entry), "-o", join(dir, "out")]);
  return `${run.code} ${run.err}`;
}

test("a user file named like a std module gets no std allowances", () => {
  const dir = scratch("fish-postgres-");
  // std's TLS helper is std's alone, so a file only named like std's can't call it.
  const helper = 'export async function secure(conn: Ref<TcpStream>): Promise<void> throws IoError | AbortError {\n  await __tlsClient(conn, "localhost", "", new AbortController().signal);\n}\n';
  const connect = 'const conn = await TcpStream.connect("127.0.0.1", 1, new AbortController().signal);\n';
  write(join(dir, "node:helper.fsh"), helper);
  write(join(dir, "main.fsh"), `import { secure } from "./node:helper.fsh";\nasync function main(): Promise<void> throws IoError | AbortError {\n  ${connect}  await secure(conn);\n}\n`);
  write(join(dir, "node:x.fsh"), `${helper}async function main(): Promise<void> throws IoError | AbortError {\n  ${connect}  await secure(conn);\n}\n`);
  for (const entry of ["main.fsh", "node:x.fsh"]) {
    const err = refusal(dir, entry);
    assert(!err.startsWith("0 ") && /error\[E0401\]: .*'__tlsClient'/.test(err), `${entry} isn't refused with E0401 naming '__tlsClient':\n${err}`);
  }
  removed(dir);
}, { timeout: 60_000 });

test("a user file named like a std module can't reach std's internal functions", () => {
  const dir = scratch("fish-postgres-");
  const calls: [string, string][] = [["fileReadSync", 'fileReadSync("x")'], ["fileRead", 'fileRead("x")'], ["shutdownSignal", "shutdownSignal()"]];
  for (const [name, call] of calls) {
    write(join(dir, "node:x.fsh"), `function main() {\n  const v = ${call};\n  console.log(v);\n}\n`);
    const err = refusal(dir, "node:x.fsh");
    assert(!err.startsWith("0 ") && err.includes("error[E0401]") && err.includes(`'${name}'`), `${call} isn't refused with E0401 naming '${name}':\n${err}`);
  }
  removed(dir);
}, { timeout: 60_000 });

// The scripted server, which runs `script`, a JavaScript expression for its Script, and stops itself
// `closeAfter` milliseconds in when that isn't 0. A rule the client breaks is recorded rather than
// thrown, as the Bun test's expect calls inside the server would fail it.
function fake(script: string, closeAfter: i64): string {
  return String.raw`import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import type { Socket } from "bun";

const dir = process.argv[2];
const problems: string[] = [];
const check = (ok: boolean, what: string) => { if (!ok) problems.push(what); };

// One message: its type byte, its length, its body.
const message = (kind: string, ...parts: Buffer[]) => {
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(5);
  head.write(kind, 0, "latin1");
  head.writeInt32BE(body.length + 4, 1);
  return Buffer.concat([head, body]);
};
const int32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n);
  return b;
};
const int16 = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeInt16BE(n);
  return b;
};
const cstring = (s: string) => Buffer.from(s + "\0", "utf8");
const ready = (status = "I") => message("Z", Buffer.from(status, "latin1"));
const errorResponse = (code: string, text: string, detail?: string) =>
  message("E", Buffer.from("SERROR\0VERROR\0C" + code + "\0M" + text + "\0" + (detail ? "D" + detail + "\0" : "") + "\0", "utf8"));
const PRESENT = message("T", int16(1), cstring("who"), int32(0), int16(0), int32(25), int16(-1), int32(-1), int16(0));
const lengthOnly = (kind: string, length: number) => {
  const head = Buffer.alloc(5);
  head.write(kind, 0, "latin1");
  head.writeInt32BE(length, 1);
  return head;
};

type Answer = { columns?: [string, number][]; rows?: (string | null)[][]; tag?: string; error?: [string, string, string?]; drop?: boolean; status?: string; delay?: number; raw?: Buffer };
type Seen = { conn: number; sql: string; params: (string | null)[] } | { conn: number; simple: string };
type Script = { auth: "trust" | "cleartext" | "md5" | "scram"; user?: string; password?: string; forgeSignature?: boolean; challenge?: (nonce: string) => string; answer?: (sql: string, params: (string | null)[]) => Answer };

function fakeServer(script: Script) {
  const seen: Seen[] = [];
  const stats = { connections: 0, busy: 0, mostBusy: 0 };
  type State = { id: number; buffer: Buffer; started: boolean; stage: string; scram?: { first: string; serverFirst: string; salted: Buffer }; sql: string; params: (string | null)[]; md5Salt?: Buffer };
  const password = script.password ?? "secret";
  const user = script.user ?? "fish";
  const finishAuth = (s: Socket<State>) => {
    s.data.stage = "ready";
    s.write(Buffer.concat([message("R", int32(0)), message("S", cstring("server_version"), cstring("17.0")), message("K", int32(1), int32(2)), ready()]));
  };
  const fail = (s: Socket<State>) => {
    s.write(errorResponse("28P01", "password authentication failed for user \"" + user + "\""));
    s.end();
  };
  const onPassword = (s: Socket<State>, body: Buffer) => {
    const st = s.data;
    if (script.auth === "cleartext") return body.toString("utf8", 0, body.length - 1) === password ? finishAuth(s) : fail(s);
    if (script.auth === "md5") {
      const inner = createHash("md5").update(password + user).digest("hex");
      const outer = "md5" + createHash("md5").update(Buffer.concat([Buffer.from(inner), st.md5Salt!])).digest("hex");
      return body.toString("utf8", 0, body.length - 1) === outer ? finishAuth(s) : fail(s);
    }
    if (!st.scram) {
      const mechanism = body.toString("utf8", 0, body.indexOf(0));
      check(mechanism === "SCRAM-SHA-256", "the mechanism is " + mechanism);
      const at = body.indexOf(0) + 1;
      const initial = body.toString("utf8", at + 4, at + 4 + body.readInt32BE(at));
      check(initial.startsWith("n,,n=,r="), "the initial message is " + initial);
      const first = initial.slice(3);
      const salt = randomBytes(16);
      const serverFirst = script.challenge?.(first.slice(5)) ?? "r=" + first.slice(5) + "server-nonce,s=" + salt.toString("base64") + ",i=4096";
      st.scram = { first, serverFirst, salted: pbkdf2Sync(password, salt, 4096, 32, "sha256") };
      return s.write(message("R", int32(11), Buffer.from(serverFirst)));
    }
    const final = body.toString("utf8");
    const withoutProof = final.slice(0, final.lastIndexOf(",p="));
    const wanted = "c=biws,r=" + st.scram.serverFirst.split(",")[0]!.slice(2);
    check(withoutProof === wanted, "the final message without its proof is " + withoutProof + ", not " + wanted);
    const proof = Buffer.from(final.slice(final.lastIndexOf(",p=") + 3), "base64");
    const authMessage = st.scram.first + "," + st.scram.serverFirst + "," + withoutProof;
    const clientKey = createHmac("sha256", st.scram.salted).update("Client Key").digest();
    const storedKey = createHash("sha256").update(clientKey).digest();
    const signature = createHmac("sha256", storedKey).update(authMessage).digest();
    const given = Buffer.from(proof.map((b, i) => b ^ signature[i]!));
    if (!createHash("sha256").update(given).digest().equals(storedKey)) return fail(s);
    const serverKey = createHmac("sha256", st.scram.salted).update("Server Key").digest();
    const verifier = script.forgeSignature ? randomBytes(32) : createHmac("sha256", serverKey).update(authMessage).digest();
    s.write(message("R", int32(12), Buffer.from("v=" + verifier.toString("base64"))));
    finishAuth(s);
  };
  const onSync = async (s: Socket<State>) => {
    const st = s.data;
    seen.push({ conn: st.id, sql: st.sql, params: st.params });
    const answer = script.answer?.(st.sql, st.params) ?? { tag: "SELECT 0", columns: [] };
    stats.busy++;
    stats.mostBusy = Math.max(stats.mostBusy, stats.busy);
    if (answer.delay) await Bun.sleep(answer.delay);
    stats.busy--;
    if (answer.drop) return s.end();
    if (answer.raw) return void s.write(answer.raw);
    const out: Buffer[] = [message("1"), message("2")];
    if (answer.error) out.push(errorResponse(...answer.error));
    else {
      const columns = answer.columns ?? [];
      out.push(columns.length === 0 ? message("n") : message("T", int16(columns.length), ...columns.flatMap(([name, oid]) => [cstring(name), int32(0), int16(0), int32(oid), int16(-1), int32(-1), int16(0)])));
      for (const row of answer.rows ?? []) {
        out.push(message("D", int16(row.length), ...row.map((v) => (v === null ? int32(-1) : Buffer.concat([int32(Buffer.byteLength(v)), Buffer.from(v)])))));
      }
      out.push(message("C", cstring(answer.tag ?? "SELECT 0")));
    }
    out.push(ready(answer.status));
    s.write(Buffer.concat(out));
  };
  const onMessage = async (s: Socket<State>, kind: string, body: Buffer) => {
    const st = s.data;
    if (kind === "p") return onPassword(s, body);
    if (kind === "P") {
      const nameEnd = body.indexOf(0);
      st.sql = body.toString("utf8", nameEnd + 1, body.indexOf(0, nameEnd + 1));
      check(body.readInt16BE(body.indexOf(0, nameEnd + 1) + 1) === 0, "a Parse names parameter types");
    } else if (kind === "B") {
      let at = body.indexOf(0, body.indexOf(0) + 1) + 1;
      check(body.readInt16BE(at) === 0, "a Bind gives parameter formats");
      const count = body.readInt16BE(at + 2);
      at += 4;
      st.params = [];
      for (let i = 0; i < count; i++) {
        const length = body.readInt32BE(at);
        at += 4;
        st.params.push(length < 0 ? null : body.toString("utf8", at, at + length));
        if (length > 0) at += length;
      }
    } else if (kind === "S") await onSync(s);
    else if (kind === "f") {
      seen.push({ conn: st.id, simple: "CopyFail: " + body.toString("utf8", 0, body.length - 1) });
      s.write(Buffer.concat([errorResponse("57014", "COPY from stdin failed"), ready()]));
    } else if (kind === "Q") {
      const sql = body.toString("utf8", 0, body.length - 1);
      seen.push({ conn: st.id, simple: sql });
      s.write(Buffer.concat([message("C", cstring(sql)), ready()]));
    }
  };
  const server = Bun.listen<State>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(s) {
        s.data = { id: ++stats.connections, buffer: Buffer.alloc(0), started: false, stage: "start", sql: "", params: [] };
      },
      async data(s, chunk) {
        const st = s.data;
        st.buffer = Buffer.concat([st.buffer, chunk]);
        while (true) {
          if (!st.started) {
            if (st.buffer.length < 4 || st.buffer.length < st.buffer.readInt32BE(0)) return;
            const length = st.buffer.readInt32BE(0);
            const startup = st.buffer.subarray(4, length);
            st.buffer = st.buffer.subarray(length);
            if (startup.readInt32BE(0) === 80877103) {
              s.write("N");
              continue;
            }
            check(startup.readInt32BE(0) === 196608, "the protocol version is " + startup.readInt32BE(0));
            const fields = startup.toString("utf8", 4).split("\0");
            check(JSON.stringify(fields.slice(0, 4)) === JSON.stringify(["user", user, "database", "db"]), "the startup fields are " + JSON.stringify(fields));
            st.started = true;
            if (script.auth === "trust") finishAuth(s);
            else if (script.auth === "cleartext") s.write(message("R", int32(3)));
            else if (script.auth === "md5") {
              st.md5Salt = randomBytes(4);
              s.write(message("R", int32(5), st.md5Salt));
            } else s.write(message("R", int32(10), cstring("SCRAM-SHA-256-PLUS"), cstring("SCRAM-SHA-256"), Buffer.from([0])));
            continue;
          }
          if (st.buffer.length < 5 || st.buffer.length < 1 + st.buffer.readInt32BE(1)) return;
          const kind = st.buffer.toString("latin1", 0, 1);
          const body = st.buffer.subarray(5, 1 + st.buffer.readInt32BE(1));
          st.buffer = st.buffer.subarray(1 + st.buffer.readInt32BE(1));
          await onMessage(s, kind, body);
        }
      },
    },
  });
  return { server, seen, stats, url: "postgres://" + user + ":" + encodeURIComponent(password) + "@127.0.0.1:" + server.port + "/db" };
}

const fake = fakeServer(SCRIPT);
function writeState() {
  const order = fake.seen.map((s) => ("simple" in s ? s.conn + ": " + s.simple : s.conn + ": " + s.sql));
  const sqls = fake.seen.map((x) => ("simple" in x ? x.simple : x.sql));
  writeFileSync(dir + "/state.part", JSON.stringify({ connections: fake.stats.connections, mostBusy: fake.stats.mostBusy, count: fake.seen.length, first: JSON.stringify(fake.seen[0] ?? null), order, sqls, problems }));
  require("node:fs").renameSync(dir + "/state.part", dir + "/state.json");
}
// SIGUSR1 asks for what it has seen so far, SIGTERM for that and an end.
process.on("SIGUSR1", writeState);
process.on("SIGTERM", () => {
  writeState();
  fake.server.stop(true);
  process.exit(0);
});
// A client that waits on a server that sent all it will gets a closed connection instead.
if (CLOSE_AFTER > 0) setTimeout(() => fake.server.stop(true), CLOSE_AFTER);
writeFileSync(dir + "/url.part", fake.url);
require("node:fs").renameSync(dir + "/url.part", dir + "/url");
`.replace("SCRIPT", script).replace("CLOSE_AFTER", `${closeAfter}`).replace("CLOSE_AFTER", `${closeAfter}`);
}

// What a scripted server saw: its connections, the most statements it answered at once, the
// statements, the first in full, each as its connection and SQL, and the SQL alone, and the rules
// the client broke.
type State = { connections: i64; mostBusy: i64; count: i64; first: string; order: string[]; sqls: string[]; problems: string[] };

// A scripted server running in the background, in a directory of its own.
type Peer = { dir: string; url: string };

function started(script: string, closeAfter: i64): Peer {
  const dir = scratch("fish-postgres-");
  const file = join(dir, "fake.ts");
  write(file, fake(script, closeAfter));
  spawnSync("sh", ["-c", `bun "$1" "$2" > /dev/null 2> "$2/peer.err" & echo $! > "$2/peer.pid"`, "sh", file, dir]);
  awaited(join(dir, "url"));
  const url = existsSync(join(dir, "url")) ? readText(join(dir, "url")) : "";
  assert(url !== "", `the scripted server never listened: ${existsSync(join(dir, "peer.err")) ? readText(join(dir, "peer.err")) : ""}`);
  return { dir, url };
}

// What the server has seen, asked of it with `signal`; it must have seen the client break no rule.
function snapshot(peer: Ref<Peer>, signal: string): State {
  const file = join(peer.dir, "state.json");
  spawnSync("sh", ["-c", `rm -f "$2"; kill -${signal} $(cat "$1/peer.pid")`, "sh", peer.dir, file]);
  awaited(file);
  let got: State = { connections: 0, mostBusy: 0, count: 0, first: "", order: [], sqls: [], problems: [] };
  try {
    got = JSON.parse<State>(readText(file));
  } catch (e) {
    assert(false, `the scripted server's state: ${e.message}\n${readText(join(peer.dir, "peer.err"))}`);
  }
  assert(got.problems.length === 0, `the client broke the protocol:\n${got.problems.join("\n")}`);
  return got;
}

// Stops the server, giving what it saw.
function stopped(peer: Ref<Peer>): State {
  const seen = snapshot(peer, "TERM");
  same(readText(join(peer.dir, "peer.err")), "", "the scripted server's stderr");
  removed(peer.dir);
  return seen;
}

test("trust, cleartext, MD5 and SCRAM-SHA-256 authenticate, and a wrong password is the server's error", () => {
  const tmp = scratch("fish-postgres-");
  const binary = built(tmp, "auth", auth());
  for (const kind of ["trust", "cleartext", "md5", "scram"]) {
    const peer = started(`{ auth: "${kind}", password: "p@ss word+1", answer: () => ({ columns: [["who", 25]], rows: [["fish"]], tag: "SELECT 1" }) }`, 0);
    same(ran(binary, [peer.url]), "connected as fish\n", `${kind}'s connection`);
    // The pool opened one connection, and ran its statement on it.
    const connections = snapshot(peer, "USR1").connections;
    assert(connections === 1, `${kind}: ${connections} connections`);
    if (kind !== "trust") same(ran(binary, [peer.url.replace("p%40ss", "wrong")]), 'PostgresError 28P01 password authentication failed for user "fish"\n', `${kind} with a wrong password`);
    stopped(peer);
  }
  removed(tmp);
}, { timeout: 60_000 });

test("a server that can't prove it knows the password is refused", () => {
  const tmp = scratch("fish-postgres-");
  const binary = built(tmp, "auth", auth());
  const peer = started(`{ auth: "scram", forgeSignature: true }`, 0);
  same(ran(binary, [peer.url]), "IoError the Postgres server's SCRAM signature doesn't match: it may not know the password\n", "the client's output");
  stopped(peer);
  removed(tmp);
}, { timeout: 60_000 });

test("sslmode=require refuses a server without TLS", () => {
  const tmp = scratch("fish-postgres-");
  const binary = built(tmp, "auth", auth());
  const peer = started(`{ auth: "trust" }`, 0);
  same(ran(binary, [`${peer.url}?sslmode=require`]), "IoError the Postgres server doesn't take TLS connections, which sslmode=require asks for\n", "the client's output");
  stopped(peer);
  removed(tmp);
}, { timeout: 60_000 });

test("parameters travel apart from the SQL as text, rows read by column name, errors and broken connections", () => {
  const tmp = scratch("fish-postgres-");
  const binary = built(tmp, "queries", queries());
  const peer = started(String.raw`{
    auth: "scram",
    answer: (sql) => {
      if (sql === "select everything") {
        return {
          columns: [["id", 20], ["name", 25], ["note", 25], ["ok", 16], ["score", 701], ["small", 21], ["raw", 17], ["doc", 3802], ["price", 1700], ["extra", 25]],
          rows: [["7", "it's", null, "t", "2.5", "-3", "\\x00ff", '{"a": [1, true]}', "12.50", "ignored"], ["9007199254740993", "", "n", "f", "-0.125", "32767", "\\x", "null", "0", null]],
          tag: "SELECT 2",
        };
      }
      if (sql === "fail") return { error: ["22012", "division by zero", "it was zero"] };
      if (sql === "update") return { tag: "UPDATE 3" };
      if (sql === "break") return { drop: true };
      if (sql === "fail in transaction") return { error: ["25P02", "current transaction is aborted"], status: "E" };
      if (sql === "after") return { tag: "INSERT 0 1" };
      return { columns: [["id", 20]], rows: [], tag: "SELECT 0" };
    },
  }`, 0);
  same(ran(binary, [peer.url]), [
    "7 it's null true 2.5 -3 [ 0, 255 ] {\"a\":[1,true]} 12.50",
    "9007199254740993  n false -0.125 32767 [] null 0",
    "PostgresError 22012 division by zero it was zero ERROR",
    "updated 3",
    "IoError the Postgres server closed the connection",
    "PostgresError 25P02",
    "after 1",
    "none true",
    "RowError the row has no column 'missing', which the type reads",
    "",
  ].join("\n"), "the client's output");
  const state = stopped(peer);
  same(state.first, `{"conn":1,"sql":"select everything","params":["7","it's",null,"true","2.5","\\\\x00ff","1970-01-01T00:00:00.000Z","9007199254740993"]}`, "the first statement the server saw");
  // The connection that broke was dropped and another opened; the failed transaction was rolled
  // back before its connection ran the next statement.
  same(JSON.stringify(state.order), JSON.stringify(["1: select everything", "1: fail", "1: update", "1: break", "2: fail in transaction", "2: ROLLBACK", "2: after", "2: empty", "2: select everything"]), "the statements in order");
  removed(tmp);
}, { timeout: 60_000 });

test("callers wait their turn for the pool's max connections, which are reused", () => {
  const tmp = scratch("fish-postgres-");
  const binary = built(tmp, "concurrent", concurrent());
  const peer = started(`{ auth: "trust", answer: (_, params) => ({ columns: [["n", 20]], rows: [[String(Number(params[0]) * 10)]], tag: "SELECT 1", delay: 30 }) }`, 0);
  same(ran(binary, [`${peer.url}?max=2`]), "sum 210\n", "the client's output");
  const state = stopped(peer);
  same(`${state.connections} ${state.mostBusy} ${state.count}`, "2 2 6", "the connections, the most busy at once and the statements");
  removed(tmp);
}, { timeout: 60_000 });

// Where Postgres's binaries are: Homebrew's postgresql@17, else the directory of `initdb` on PATH.
function pgBin(): string {
  if (existsSync("/opt/homebrew/opt/postgresql@17/bin/initdb")) return "/opt/homebrew/opt/postgresql@17/bin";
  const found = text(spawnSync("sh", ["-c", "command -v initdb"]).stdout).trim();
  return found === "" ? "" : found.slice(0, found.lastIndexOf("/") as i64);
}

// Typed rows, errors, a transaction left open, many tasks on a small pool, a connection killed
// under it, and over TLS, the connection's encryption.
function real(): string {
  return `import { Pool, PostgresError, RowError, SqlValue } from "postgres";

type Item = { id: i64; name: string; price: string; tags: Json; note: string | null; small: i16; made: string };
type Count = { n: i64 };

async function slow(pool: Pool, i: i64): Promise<i64> {
  try {
    const row = await pool.queryOne<Count>("select $1::int8 * 2 as n, pg_sleep(0.05)::text as slept", [i]);
    return row === null ? -1 : row.n;
  } catch (e) {
    console.log("failed", e.message);
    return -1000;
  }
}

async function main(): Promise<void> throws IoError | AbortError | TypeError | PostgresError | RowError {
  const pool = await Pool.connect(process.argv[2]);
  if (process.argv[3] === "tls") {
    const tls = await pool.queryOne<{ ssl: boolean }>("select ssl from pg_stat_ssl where pid = pg_backend_pid()");
    if (tls !== null) console.log("ssl", tls.ssl);
    return;
  }
  await pool.execute("create table items (id int8 primary key, name text not null, price numeric, tags jsonb, note text, small int2, made timestamptz)");
  const params: SqlValue[] = [1, "pen's \\"best\\"", "1.25", "[1, 2]", null, 3, new Date(0)];
  const inserted = await pool.execute("insert into items values ($1, $2, $3::numeric, $4::jsonb, $5, $6, $7), (2, 'cup', 3.5, '{\\"x\\": true}', 'hi', -4, '2024-05-06 07:08:09+00')", params);
  console.log("inserted", inserted);
  const items = await pool.query<Item>("select *, 'more' as extra from items order by id");
  for (const it of items) console.log(it.id, it.name, it.price, JSON.stringify(it.tags), it.note, it.small, it.made);
  const none = await pool.queryOne<Item>("select * from items where id = $1", [99]);
  console.log("none", none === null);
  try {
    await pool.query<Item>("select id, null::text as name, price, tags, note, small, made from items");
  } catch (e) {
    if (e instanceof RowError) console.log("RowError", e.message);
  }
  try {
    await pool.execute("insert into items (id, name) values (1, 'again')");
  } catch (e) {
    if (e instanceof PostgresError) console.log("PostgresError", e.code, e.message, e.detail);
  }
  // A transaction a statement leaves open is rolled back before the connection is used again.
  await pool.execute("begin");
  const open = await pool.queryOne<Count>("select count(*) as n from pg_stat_activity where state like 'idle in transaction%'");
  if (open !== null) console.log("idle in transaction", open.n);
  let handles: JoinHandle<i64>[] = [];
  for (let i: i64 = 1; i <= 6; i++) handles.push(spawn(slow(pool.clone(), i)));
  let sum: i64 = 0;
  while (handles.length > 0) {
    const h = handles.pop()!;
    const n = await h;
    sum += n;
  }
  console.log("sum", sum);
  const conns = await pool.queryOne<Count>("select count(*) as n from pg_stat_activity where backend_type = 'client backend'");
  if (conns !== null) console.log("connections", conns.n);
  try {
    await pool.execute("select pg_terminate_backend(pg_backend_pid())");
  } catch (e) {
    if (e instanceof IoError) console.log("IoError", e.message);
  }
  const again = await pool.queryOne<Count>("select 1 as n");
  if (again !== null) console.log("again", again.n);
}
`;
}

// A throwaway Postgres: a cluster made in a temporary directory, on a free port, with SCRAM
// passwords and TLS from the test certificates, running `real()` with the URL plus `query` and
// `mode`, and stopped after. Never any other server. Postgres on macOS refuses to start with no
// locale in its environment, so it gets C when none is set. Gives the program's exit code, stderr and
// stdout, or "" when no Postgres is installed.
function againstReal(query: string, mode: string): string {
  const bin = pgBin();
  if (bin === "") {
    console.log("postgres.fsh: no initdb found, in /opt/homebrew/opt/postgresql@17/bin or on PATH, so the tests against a real Postgres are skipped");
    return "";
  }
  const tmp = scratch("fish-postgres-");
  const binary = built(tmp, "real", real());
  write(join(tmp, "pw"), "pa ss+word\n");
  const port = freePort();
  const fixtures = join(root(), "tests", "fixtures", "tls");
  const url = `postgres://fish:pa%20ss%2Bword@localhost:${port}/postgres${query}`;
  const script = `tmp=$1 bin=$2 port=$3 fixtures=$4
dir="$tmp/cluster"
"$bin/initdb" -D "$dir" -U fish --auth=scram-sha-256 --pwfile="$tmp/pw" -E UTF8 --no-locale > "$tmp/initdb.log" 2>&1 || { echo "initdb failed: $(cat "$tmp/initdb.log")"; exit 1; }
cp "$fixtures/server.pem" "$fixtures/server-key.pem" "$dir/" && chmod 600 "$dir/server-key.pem"
LC_ALL=\${LC_ALL:-C} "$bin/pg_ctl" -D "$dir" -o "-p $port -k $tmp -c listen_addresses=127.0.0.1 -c ssl=on -c ssl_cert_file=server.pem -c ssl_key_file=server-key.pem -c timezone=UTC" -l "$tmp/postgres.log" -w start > /dev/null 2>&1 || { echo "pg_ctl start failed: $(cat "$tmp/postgres.log")"; exit 1; }
trap '"$bin/pg_ctl" -D "$dir" -m immediate stop > /dev/null 2>&1' EXIT
env FISH_LEAKS=1 "$5" "$6" "$7" 2> "$tmp/err" > "$tmp/out"
echo "$? $(cat "$tmp/err")$(cat "$tmp/out")"`;
  const run = spawnSync("sh", ["-c", script, "sh", tmp, bin, `${port}`, fixtures, binary, url, mode]);
  removed(tmp);
  return text(run.stdout);
}

test("a real Postgres: SCRAM, typed rows, errors, a small pool shared by many tasks, a killed connection", () => {
  const got = againstReal("?max=3", "");
  if (got === "") return;
  same(got, [
    "0 inserted 2",
    '1 pen\'s "best" 1.25 [1,2] null 3 1970-01-01 00:00:00+00',
    '2 cup 3.5 {"x":true} hi -4 2024-05-06 07:08:09+00',
    "none true",
    "RowError column 'name' is null, which its field can't hold; type it 'T | null'",
    "PostgresError 23505 duplicate key value violates unique constraint \"items_pkey\" Key (id)=(1) already exists.",
    "idle in transaction 0",
    "sum 42",
    "connections 3",
    "IoError the Postgres server closed the connection",
    "again 1",
    "",
  ].join("\n"), "the exit code, stderr and output");
}, { timeout: 60_000 });

// `s` as encodeURIComponent writes it, which Fish doesn't have yet: every UTF-8 byte but the
// unreserved ASCII ones as %XX.
function uriComponent(s: string): string {
  const keep = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()";
  let out = "";
  for (const b of new TextEncoder().encode(s)) {
    const c = String.fromCharCode(b as u16);
    const hex = "0123456789ABCDEF";
    out += b < 128 && keep.includes(c) ? c : "%" + hex[(b >> 4) as usize] + hex[(b & 15) as usize];
  }
  return out;
}

test("a real Postgres over TLS, its certificate verified against sslrootcert", () => {
  const ca = join(root(), "tests", "fixtures", "tls", "ca.pem");
  const got = againstReal(`?sslmode=require&sslrootcert=${uriComponent(ca)}`, "tls");
  if (got === "") return;
  same(got, "0 ssl true\n", "the exit code, stderr and output");
}, { timeout: 60_000 });

// A server that misbehaves is refused with an error, never trusted, panicked on or waited on.
function hostile(script: string, said: string): void {
  const tmp = scratch("fish-postgres-");
  const binary = built(tmp, "auth", auth());
  const peer = started(script, 3000);
  same(ran(binary, [peer.url]), `${said}\n`, "the client's output");
  stopped(peer);
  removed(tmp);
}

test("refused: a SCRAM nonce that doesn't extend the client's", () => {
  hostile(`{ auth: "scram", challenge: () => "r=attacker,s=c2FsdA==,i=4096" }`, "IoError the Postgres server sent a malformed SCRAM challenge");
}, { timeout: 60_000 });

test("refused: no SCRAM iterations", () => {
  hostile(`{ auth: "scram", challenge: (nonce) => "r=" + nonce + "x,s=c2FsdA==,i=0" }`, "IoError the Postgres server sent a malformed SCRAM challenge");
}, { timeout: 60_000 });

test("refused: too many SCRAM iterations", () => {
  hostile(`{ auth: "scram", challenge: (nonce) => "r=" + nonce + "x,s=c2FsdA==,i=2147483647" }`, "IoError the Postgres server asks for 2147483647 SCRAM iterations, more than the 10000000 Fish allows, as hashing that many would hold a thread for minutes");
}, { timeout: 60_000 });

test("refused: a RowDescription shorter than its columns", () => {
  hostile(`{ auth: "trust", answer: () => ({ raw: Buffer.concat([message("1"), message("2"), message("T", int16(1), cstring("who")), ready()]) }) }`, "IoError the Postgres server sent a malformed message");
}, { timeout: 60_000 });

test("refused: a DataRow value longer than its body", () => {
  hostile(`{ auth: "trust", answer: () => ({ raw: Buffer.concat([message("1"), message("2"), PRESENT, message("D", int16(1), int32(1000)), ready()]) }) }`, "IoError the Postgres server sent a malformed message");
}, { timeout: 60_000 });

test("refused: a DataRow whose count isn't its columns'", () => {
  hostile(`{ auth: "trust", answer: () => ({ raw: Buffer.concat([message("1"), message("2"), PRESENT, message("D", int16(0), int32(3), Buffer.from("abc")), ready()]) }) }`, "IoError the Postgres server sent a malformed message");
}, { timeout: 60_000 });

test("refused: a length under 4", () => {
  hostile(`{ auth: "trust", answer: () => ({ raw: Buffer.concat([message("1"), lengthOnly("N", -5), Buffer.alloc(64)]) }) }`, "IoError the Postgres server sent a malformed message");
}, { timeout: 60_000 });

test("refused: a message over 1 GiB", () => {
  hostile(`{ auth: "trust", answer: () => ({ raw: Buffer.concat([message("1"), lengthOnly("D", 1073741829)]) }) }`, "IoError the Postgres server sent a message of 1073741830 bytes, more than the 1 GiB Postgres itself can send");
}, { timeout: 60_000 });

test("COPY FROM STDIN is answered with CopyFail, and the connection goes on", () => {
  const tmp = scratch("fish-postgres-");
  const binary = built(tmp, "copy", copy());
  const peer = started(`{ auth: "trust", answer: (sql) => (sql === "copy" ? { raw: Buffer.concat([message("1"), message("2"), message("n"), message("G", Buffer.from([0]), int16(0))]) } : { tag: "SELECT 0" }) }`, 0);
  same(ran(binary, [peer.url]), "PostgresError 57014 COPY from stdin failed\nafter 0\n", "the client's output");
  const state = stopped(peer);
  same(JSON.stringify(state.sqls), JSON.stringify(["copy", "CopyFail: COPY FROM STDIN isn't supported by Fish's postgres module", "after"]), "the statements the server saw");
  removed(tmp);
}, { timeout: 60_000 });
