import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Socket } from "bun";
import { newSession } from "../src/compilation.ts";
import { buildAsync } from "../src/main.ts";

// The postgres module against a scripted server speaking Postgres's wire protocol, written here,
// and against a throwaway Postgres when one is installed. Each program is built with clang, which
// can be slow on a busy machine.
setDefaultTimeout(60_000);

const tmp = mkdtempSync(join(tmpdir(), "fish-postgres-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
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

let binaries: { auth: string; queries: string; concurrent: string };
beforeAll(async () => {
  const [auth, queries, concurrent] = await Promise.all([build("auth", AUTH), build("queries", QUERIES), build("concurrent", CONCURRENT)]);
  binaries = { auth, queries, concurrent };
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
type Answer = { columns?: [string, number][]; rows?: (string | null)[][]; tag?: string; error?: [string, string, string?]; drop?: boolean; status?: string; delay?: number };
type Seen = { conn: number; sql: string; params: (string | null)[] } | { conn: number; simple: string };
type Script = { auth: "trust" | "cleartext" | "md5" | "scram"; user?: string; password?: string; forgeSignature?: boolean; answer?: (sql: string, params: (string | null)[]) => Answer };

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
      const serverFirst = `r=${first.slice(5)}server-nonce,s=${salt.toString("base64")},i=4096`;
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
    else if (kind === "Q") {
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
