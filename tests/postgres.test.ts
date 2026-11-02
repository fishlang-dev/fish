import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Socket } from "bun";
import { newSession } from "../src/compilation.ts";
import { buildAsync } from "../src/main.ts";

// The postgres module against a scripted server speaking Postgres's wire protocol, written here,
// and against a throwaway Postgres when one is installed. Each program is built with clang, which
// can be slow on a busy machine.
setDefaultTimeout(60_000);

const tmp = mkdtempSync(join(tmpdir(), "fish-postgres-"));
// The throwaway Postgres further down, once started, stops before its directory goes.
let real: { url: string; stop: () => void; binary: Promise<string> } | undefined;
afterAll(() => {
  real?.stop();
  rmSync(tmp, { recursive: true, force: true });
});
const session = newSession();

async function build(name: string, src: string): Promise<string> {
  const file = join(tmp, `${name}.fsh`);
  writeFileSync(file, src);
  const out = join(tmp, name);
  await buildAsync(session, file, out);
  return out;
}

async function run(binary: string, args: string[]): Promise<string> {
  const proc = Bun.spawn([binary, ...args], { env: { ...process.env, FISH_LEAKS: "1" }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  expect(stderr).toBe("");
  expect(await proc.exited).toBe(0);
  return stdout;
}

// Connects to the URL it's given and prints a row, or the error that stopped it.
const AUTH = `import { Pool, PostgresError, RowError } from "postgres";

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

// Every kind of value through one statement, then a server error, a broken connection, a failed
// transaction and an empty result, each followed by a statement that shows the pool went on.
const QUERIES = `import { Pool, PostgresError, RowError, SqlValue } from "postgres";

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

// Many tasks sharing one pool of the URL's size.
const CONCURRENT = `import { Pool, PostgresError } from "postgres";

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

// A COPY FROM STDIN, then a statement on the same connection.
const COPY = `import { Pool, PostgresError } from "postgres";

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

let binaries: { auth: string; queries: string; concurrent: string; copy: string };
beforeAll(async () => {
  const [auth, queries, concurrent, copy] = await Promise.all([build("auth", AUTH), build("queries", QUERIES), build("concurrent", CONCURRENT), build("copy", COPY)]);
  binaries = { auth, queries, concurrent, copy };
});

test("a user file named like a std module gets no std allowances", async () => {
  const dir = mkdtempSync(join(tmp, "named-"));
  // std's TLS helper is std's alone, so a file only named like std's can't call it.
  const helper = 'export async function secure(conn: Ref<TcpStream>): Promise<void> throws IoError | AbortError {\n  await __tlsClient(conn, "localhost", "", new AbortController().signal);\n}\n';
  const connect = 'const conn = await TcpStream.connect("127.0.0.1", 1, new AbortController().signal);\n';
  writeFileSync(join(dir, "node:helper.fsh"), helper);
  writeFileSync(join(dir, "main.fsh"), `import { secure } from "./node:helper.fsh";\nasync function main(): Promise<void> throws IoError | AbortError {\n  ${connect}  await secure(conn);\n}\n`);
  writeFileSync(join(dir, "node:x.fsh"), `${helper}async function main(): Promise<void> throws IoError | AbortError {\n  ${connect}  await secure(conn);\n}\n`);
  for (const entry of ["main.fsh", "node:x.fsh"]) {
    await expect(buildAsync(session, join(dir, entry), join(dir, "out"))).rejects.toMatchObject({ code: "E0401", message: expect.stringContaining("'__tlsClient'") });
  }
});

test("a user file named like a std module can't reach std's internal functions", async () => {
  const dir = mkdtempSync(join(tmp, "internal-"));
  for (const [name, call] of [["fileReadSync", 'fileReadSync("x")'], ["fileRead", 'fileRead("x")'], ["shutdownSignal", "shutdownSignal()"]]) {
    writeFileSync(join(dir, "node:x.fsh"), `function main() {\n  const v = ${call};\n  console.log(v);\n}\n`);
    await expect(buildAsync(session, join(dir, "node:x.fsh"), join(dir, "out"))).rejects.toMatchObject({ code: "E0401", message: expect.stringContaining(`'${name}'`) });
  }
});

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
const cstring = (s: string) => Buffer.from(`${s}\0`, "utf8");
const ready = (status = "I") => message("Z", Buffer.from(status, "latin1"));
const errorResponse = (code: string, text: string, detail?: string) =>
  message("E", Buffer.from(`SERROR\0VERROR\0C${code}\0M${text}\0${detail ? `D${detail}\0` : ""}\0`, "utf8"));

// What a statement gives: columns as name and type OID, rows as text or null, and its tag; or the
// error it raises; or the connection dropped. status is the transaction status after it.
// raw is sent in place of every reply, for servers that misbehave.
type Answer = { columns?: [string, number][]; rows?: (string | null)[][]; tag?: string; error?: [string, string, string?]; drop?: boolean; status?: string; delay?: number; raw?: Buffer };
type Seen = { conn: number; sql: string; params: (string | null)[] } | { conn: number; simple: string };
// challenge, given the client's nonce, replaces the SCRAM server-first message a server would send.
type Script = { auth: "trust" | "cleartext" | "md5" | "scram"; user?: string; password?: string; forgeSignature?: boolean; challenge?: (nonce: string) => string; answer?: (sql: string, params: (string | null)[]) => Answer };

// A server for one test: each connection is authenticated as the script says, then each Sync
// answers the statement parsed and bound before it.
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
    s.write(errorResponse("28P01", `password authentication failed for user "${user}"`));
    s.end();
  };
  const onPassword = (s: Socket<State>, body: Buffer) => {
    const st = s.data;
    if (script.auth === "cleartext") return body.toString("utf8", 0, body.length - 1) === password ? finishAuth(s) : fail(s);
    if (script.auth === "md5") {
      const inner = createHash("md5").update(password + user).digest("hex");
      const outer = `md5${createHash("md5").update(Buffer.concat([Buffer.from(inner), st.md5Salt!])).digest("hex")}`;
      return body.toString("utf8", 0, body.length - 1) === outer ? finishAuth(s) : fail(s);
    }
    if (!st.scram) {
      const mechanism = body.toString("utf8", 0, body.indexOf(0));
      expect(mechanism).toBe("SCRAM-SHA-256");
      const at = body.indexOf(0) + 1;
      const initial = body.toString("utf8", at + 4, at + 4 + body.readInt32BE(at));
      expect(initial.startsWith("n,,n=,r=")).toBe(true);
      const first = initial.slice(3);
      const salt = randomBytes(16);
      const serverFirst = script.challenge?.(first.slice(5)) ?? `r=${first.slice(5)}server-nonce,s=${salt.toString("base64")},i=4096`;
      st.scram = { first, serverFirst, salted: pbkdf2Sync(password, salt, 4096, 32, "sha256") };
      return s.write(message("R", int32(11), Buffer.from(serverFirst)));
    }
    const final = body.toString("utf8");
    const withoutProof = final.slice(0, final.lastIndexOf(",p="));
    expect(withoutProof).toBe(`c=biws,r=${st.scram.serverFirst.split(",")[0]!.slice(2)}`);
    const proof = Buffer.from(final.slice(final.lastIndexOf(",p=") + 3), "base64");
    const authMessage = `${st.scram.first},${st.scram.serverFirst},${withoutProof}`;
    const clientKey = createHmac("sha256", st.scram.salted).update("Client Key").digest();
    const storedKey = createHash("sha256").update(clientKey).digest();
    const signature = createHmac("sha256", storedKey).update(authMessage).digest();
    const given = Buffer.from(proof.map((b, i) => b ^ signature[i]!));
    if (!createHash("sha256").update(given).digest().equals(storedKey)) return fail(s);
    const serverKey = createHmac("sha256", st.scram.salted).update("Server Key").digest();
    const verifier = script.forgeSignature ? randomBytes(32) : createHmac("sha256", serverKey).update(authMessage).digest();
    s.write(message("R", int32(12), Buffer.from(`v=${verifier.toString("base64")}`)));
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
      expect(body.readInt16BE(body.indexOf(0, nameEnd + 1) + 1)).toBe(0);
    } else if (kind === "B") {
      let at = body.indexOf(0, body.indexOf(0) + 1) + 1;
      expect(body.readInt16BE(at)).toBe(0);
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
      seen.push({ conn: st.id, simple: `CopyFail: ${body.toString("utf8", 0, body.length - 1)}` });
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
            expect(startup.readInt32BE(0)).toBe(196608);
            const fields = startup.toString("utf8", 4).split("\0");
            expect(fields.slice(0, 4)).toEqual(["user", user, "database", "db"]);
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
  return { server, seen, stats, url: (query = "") => `postgres://${user}:${encodeURIComponent(password)}@127.0.0.1:${server.port}/db${query}` };
}

test("trust, cleartext, MD5 and SCRAM-SHA-256 authenticate, and a wrong password is the server's error", async () => {
  const answer = () => ({ columns: [["who", 25]] as [string, number][], rows: [["fish"]], tag: "SELECT 1" });
  for (const auth of ["trust", "cleartext", "md5", "scram"] as const) {
    const fake = fakeServer({ auth, password: "p@ss word+1", answer });
    try {
      expect(await run(binaries.auth, [fake.url()])).toBe("connected as fish\n");
      // The pool opened one connection, and ran its statement on it.
      expect(fake.stats.connections).toBe(1);
      if (auth !== "trust") expect(await run(binaries.auth, [fake.url().replace("p%40ss", "wrong")])).toBe('PostgresError 28P01 password authentication failed for user "fish"\n');
    } finally {
      fake.server.stop(true);
    }
  }
});

test("a server that can't prove it knows the password is refused", async () => {
  const fake = fakeServer({ auth: "scram", forgeSignature: true });
  try {
    expect(await run(binaries.auth, [fake.url()])).toBe("IoError the Postgres server's SCRAM signature doesn't match: it may not know the password\n");
  } finally {
    fake.server.stop(true);
  }
});

test("sslmode=require refuses a server without TLS", async () => {
  const fake = fakeServer({ auth: "trust" });
  try {
    expect(await run(binaries.auth, [fake.url("?sslmode=require")])).toBe("IoError the Postgres server doesn't take TLS connections, which sslmode=require asks for\n");
  } finally {
    fake.server.stop(true);
  }
});

test("parameters travel apart from the SQL as text, rows read by column name, errors and broken connections", async () => {
  const fake = fakeServer({
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
  });
  try {
    expect(await run(binaries.queries, [fake.url()])).toBe([
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
    ].join("\n"));
    const first = fake.seen[0]!;
    expect(first).toEqual({ conn: 1, sql: "select everything", params: ["7", "it's", null, "true", "2.5", "\\x00ff", "1970-01-01T00:00:00.000Z", "9007199254740993"] });
    // The connection that broke was dropped and another opened; the failed transaction was rolled
    // back before its connection ran the next statement.
    const order = fake.seen.map((s) => ("simple" in s ? `${s.conn}: ${s.simple}` : `${s.conn}: ${s.sql}`));
    expect(order).toEqual(["1: select everything", "1: fail", "1: update", "1: break", "2: fail in transaction", "2: ROLLBACK", "2: after", "2: empty", "2: select everything"]);
  } finally {
    fake.server.stop(true);
  }
});

test("callers wait their turn for the pool's max connections, which are reused", async () => {
  const fake = fakeServer({ auth: "trust", answer: (_, params) => ({ columns: [["n", 20]], rows: [[String(Number(params[0]) * 10)]], tag: "SELECT 1", delay: 30 }) });
  try {
    expect(await run(binaries.concurrent, [fake.url("?max=2")])).toBe("sum 210\n");
    expect(fake.stats.connections).toBe(2);
    expect(fake.stats.mostBusy).toBe(2);
    expect(fake.seen.length).toBe(6);
  } finally {
    fake.server.stop(true);
  }
});

// A throwaway Postgres: a cluster made in a temporary directory, on a free port, with SCRAM
// passwords and TLS from the test certificates, stopped after the tests. Never any other server.
const PG_BIN = ["/opt/homebrew/opt/postgresql@17/bin", ...(Bun.which("initdb") ? [dirname(Bun.which("initdb")!)] : [])].find((dir) => existsSync(join(dir, "initdb")));
if (!PG_BIN) console.log("postgres.test.ts: no initdb found, in /opt/homebrew/opt/postgresql@17/bin or on PATH, so the tests against a real Postgres are skipped");

// Typed rows, errors, a transaction left open, many tasks on a small pool, a connection killed
// under it, and over TLS, the connection's encryption.
const REAL = `import { Pool, PostgresError, RowError, SqlValue } from "postgres";

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

beforeAll(async () => {
  if (!PG_BIN) return;
  const dir = join(tmp, "cluster");
  writeFileSync(join(tmp, "pw"), "pa ss+word\n");
  const init = Bun.spawnSync([join(PG_BIN, "initdb"), "-D", dir, "-U", "fish", "--auth=scram-sha-256", `--pwfile=${join(tmp, "pw")}`, "-E", "UTF8", "--no-locale"], { stdout: "pipe", stderr: "pipe" });
  if (init.exitCode !== 0) throw new Error(`initdb failed: ${init.stderr}`);
  const fixtures = join(import.meta.dir, "fixtures", "tls");
  copyFileSync(join(fixtures, "server.pem"), join(dir, "server.pem"));
  copyFileSync(join(fixtures, "server-key.pem"), join(dir, "server-key.pem"));
  chmodSync(join(dir, "server-key.pem"), 0o600);
  const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const port = probe.port;
  probe.stop(true);
  const options = `-p ${port} -k ${tmp} -c listen_addresses=127.0.0.1 -c ssl=on -c ssl_cert_file=server.pem -c ssl_key_file=server-key.pem -c timezone=UTC`;
  const start = Bun.spawnSync([join(PG_BIN, "pg_ctl"), "-D", dir, "-o", options, "-l", join(tmp, "postgres.log"), "-w", "start"], { stdout: "pipe", stderr: "pipe" });
  if (start.exitCode !== 0) throw new Error(`pg_ctl start failed: ${start.stderr}${readFileSync(join(tmp, "postgres.log"), "utf8")}`);
  real = {
    binary: build("real", REAL),
    url: `postgres://fish:pa%20ss%2Bword@localhost:${port}/postgres`,
    stop: () => void Bun.spawnSync([join(PG_BIN, "pg_ctl"), "-D", dir, "-m", "immediate", "stop"], { stdout: "pipe", stderr: "pipe" }),
  };
});

test.skipIf(!PG_BIN)("a real Postgres: SCRAM, typed rows, errors, a small pool shared by many tasks, a killed connection", async () => {
  const binary = await real!.binary;
  expect(await run(binary, [`${real!.url}?max=3`, ""])).toBe([
    "inserted 2",
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
  ].join("\n"));
});

test.skipIf(!PG_BIN)("a real Postgres over TLS, its certificate verified against sslrootcert", async () => {
  const binary = await real!.binary;
  const ca = join(import.meta.dir, "fixtures", "tls", "ca.pem");
  expect(await run(binary, [`${real!.url}?sslmode=require&sslrootcert=${encodeURIComponent(ca)}`, "tls"])).toBe("ssl true\n");
});

// A server that misbehaves is refused with an error, never trusted, panicked on or waited on.
const PRESENT = message("T", int16(1), cstring("who"), int32(0), int16(0), int32(25), int16(-1), int32(-1), int16(0));
const lengthOnly = (kind: string, length: number) => {
  const head = Buffer.alloc(5);
  head.write(kind, 0, "latin1");
  head.writeInt32BE(length, 1);
  return head;
};
const HOSTILE: [string, Partial<Script>, string][] = [
  ["a SCRAM nonce that doesn't extend the client's", { auth: "scram", challenge: () => "r=attacker,s=c2FsdA==,i=4096" }, "IoError the Postgres server sent a malformed SCRAM challenge"],
  ["no SCRAM iterations", { auth: "scram", challenge: (nonce) => `r=${nonce}x,s=c2FsdA==,i=0` }, "IoError the Postgres server sent a malformed SCRAM challenge"],
  ["too many SCRAM iterations", { auth: "scram", challenge: (nonce) => `r=${nonce}x,s=c2FsdA==,i=2147483647` }, "IoError the Postgres server asks for 2147483647 SCRAM iterations, more than the 10000000 Fish allows, as hashing that many would hold a thread for minutes"],
  ["a RowDescription shorter than its columns", { answer: () => ({ raw: Buffer.concat([message("1"), message("2"), message("T", int16(1), cstring("who")), ready()]) }) }, "IoError the Postgres server sent a malformed message"],
  ["a DataRow value longer than its body", { answer: () => ({ raw: Buffer.concat([message("1"), message("2"), PRESENT, message("D", int16(1), int32(1000)), ready()]) }) }, "IoError the Postgres server sent a malformed message"],
  ["a DataRow whose count isn't its columns'", { answer: () => ({ raw: Buffer.concat([message("1"), message("2"), PRESENT, message("D", int16(0), int32(3), Buffer.from("abc")), ready()]) }) }, "IoError the Postgres server sent a malformed message"],
  ["a length under 4", { answer: () => ({ raw: Buffer.concat([message("1"), lengthOnly("N", -5), Buffer.alloc(64)]) }) }, "IoError the Postgres server sent a malformed message"],
  ["a message over 1 GiB", { answer: () => ({ raw: Buffer.concat([message("1"), lengthOnly("D", 1073741829)]) }) }, "IoError the Postgres server sent a message of 1073741830 bytes, more than the 1 GiB Postgres itself can send"],
];
for (const [what, script, said] of HOSTILE) {
  test(`refused: ${what}`, async () => {
    const fake = fakeServer({ auth: "trust", ...script });
    // A client that waits on a server that sent all it will gets a closed connection instead.
    const closing = setTimeout(() => fake.server.stop(true), 3000);
    try {
      expect(await run(binaries.auth, [fake.url()])).toBe(`${said}\n`);
    } finally {
      clearTimeout(closing);
      fake.server.stop(true);
    }
  }, 15_000);
}

test("COPY FROM STDIN is answered with CopyFail, and the connection goes on", async () => {
  const fake = fakeServer({
    auth: "trust",
    answer: (sql) => (sql === "copy" ? { raw: Buffer.concat([message("1"), message("2"), message("n"), message("G", Buffer.from([0]), int16(0))]) } : { tag: "SELECT 0" }),
  });
  try {
    expect(await run(binaries.copy, [fake.url()])).toBe("PostgresError 57014 COPY from stdin failed\nafter 0\n");
    expect(fake.seen.map((x) => ("simple" in x ? x.simple : x.sql))).toEqual(["copy", "CopyFail: COPY FROM STDIN isn't supported by Fish's postgres module", "after"]);
  } finally {
    fake.server.stop(true);
  }
});
