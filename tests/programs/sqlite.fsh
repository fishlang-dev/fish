// The sqlite module over the system's SQLite, on databases in memory and in a temp directory.
// case: sqlite_typed_rows
// expect: 0 0
// expect: 1 1
// expect: 1 9007199254740993
// expect: 1 true 2.5 [ 0, 1, 255 ] null 1
// expect: 9007199254740993 "" 3 [] héllo 0
// expect: integer real real text blob null integer integer
// expect: Infinity -Infinity null 0.1
// Every parameter shape goes in and comes back by column name: a boolean as 0 or 1, bytes as a
// BLOB, an i64 past what an f64 holds whole, and text with what JSON escapes.
import { Database, RowError, SqliteError } from "sqlite";

type Item = { id: i64; name: string; price: f64; data: u8[]; note: string | null; live: i64 };
type Kinds = { a: string; b: string; c: string; d: string; e: string; f: string; g: string; h: string };

async function main(): Promise<void> throws SqliteError | RowError {
  const db = await Database.open(":memory:");
  const made = await db.run("create table items (id integer primary key, name text not null, price real, data blob, note text, live integer)");
  console.log(made.changes, made.lastInsertRowid);
  const awkward = "tea \"green\"\\\n\tcha\u0001";
  const bytes: u8[] = [0, 1, 255];
  const first = await db.run("insert into items (name, price, data, note, live) values (?, ?, ?, ?, ?)", [awkward, 2.5, bytes.clone(), null, true]);
  console.log(first.changes, first.lastInsertRowid);
  const big: i64 = 9007199254740993;
  const second = await db.run("insert into items values (?, ?, ?, ?, ?, ?)", [big, "", 3, [], "héllo", false]);
  console.log(second.changes, second.lastInsertRowid);
  const rows = await db.query<Item>("select * from items order by id");
  console.log(rows[0].id, rows[0].name === awkward, rows[0].price, rows[0].data, rows[0].note, rows[0].live);
  console.log(rows[1].id, JSON.stringify(rows[1].name), rows[1].price, rows[1].data, rows[1].note, rows[1].live);
  const whole: f64 = 2.0;
  const k = await db.queryOne<Kinds>(
    "select typeof(?) as a, typeof(?) as b, typeof(?) as c, typeof(?) as d, typeof(?) as e, typeof(?) as f, typeof(?) as g, typeof(?) as h",
    [2, whole, 2.5, "x", bytes, null, true, big],
  );
  if (k !== null) console.log(k.a, k.b, k.c, k.d, k.e, k.f, k.g, k.h);
  const infinity: f64 = 1e300 * 1e300;
  const edges = await db.query<{ up: f64; down: f64; nan: f64 | null; tenth: f64 }>("select ? as up, ? as down, ? as nan, ? as tenth", [infinity, -infinity, infinity - infinity, 0.1]);
  console.log(edges[0].up, edges[0].down, edges[0].nan, edges[0].tenth);
}
// case: sqlite_query_one
// expect: { name: 'b' }
// expect: null
// expect: 3
// queryOne gives the first row, or null when there is none, and stops reading there.
import { Database, RowError, SqliteError } from "sqlite";

async function main(): Promise<void> throws SqliteError | RowError {
  const db = await Database.open(":memory:");
  await db.run("create table t (id integer primary key, name text)");
  const filled = await db.run("insert into t (name) values ('a'), ('b'), ('c')");
  const one = await db.queryOne<{ name: string }>("select name from t where id >= ? order by id", [2]);
  console.log(one);
  const none = await db.queryOne<{ name: string }>("select name from t where id = ?", [7]);
  console.log(none);
  console.log(filled.changes);
}
// case: sqlite_errors
// expect: SqliteError 1 near "selec": syntax error
// expect: SqliteError 1 no such table: nowhere
// expect: SqliteError 19 UNIQUE constraint failed: t.id
// expect: SqliteError 19 NOT NULL constraint failed: t.name
// expect: SqliteError 25 the statement takes 2 parameters, but 1 was given
// expect: SqliteError 25 the statement takes 1 parameter, but 0 were given
// expect: SqliteError 1 the SQL holds more than one statement; run each with a call of its own
// expect: SqliteError 1 the SQL holds no statement
// expect: SqliteError 14 unable to open database file
// expect: SqliteError 14 a database's path can't hold a NUL character
// expect: 1
// What SQLite refuses is a SqliteError with its message and primary result code, and so is what
// the module refuses before SQLite would drop it unsaid: parameters that don't match the
// statement's, and SQL holding more than one statement. The connection goes on after each.
import { Database, SqliteError, SqlValue } from "sqlite";

async function attempt(db: Ref<Database>, sql: string, params: SqlValue[]): Promise<void> {
  try {
    await db.run(sql, params);
    console.log("ran");
  } catch (e) {
    console.log(e.name, e.code, e.message);
  }
}

async function opening(path: string): Promise<void> {
  try {
    const _db = await Database.open(path);
    console.log("opened");
  } catch (e) {
    console.log(e.name, e.code, e.message);
  }
}

async function main(): Promise<void> throws SqliteError {
  const db = await Database.open(":memory:");
  await db.run("create table t (id integer primary key, name text not null)");
  await db.run("insert into t values (1, 'a')");
  await attempt(db, "selec 1", []);
  await attempt(db, "select * from nowhere", []);
  await attempt(db, "insert into t values (1, 'again')", []);
  await attempt(db, "insert into t values (2, ?)", [null]);
  await attempt(db, "insert into t values (?, ?)", [2]);
  await attempt(db, "insert into t (name) values (?)", []);
  await attempt(db, "insert into t values (2, 'b'); insert into t values (3, 'c')", []);
  await attempt(db, "  -- nothing to run\n", []);
  await opening("/nowhere/at/all/fish.db");
  await opening("a\0b");
  const left = await db.run("delete from t");
  console.log(left.changes);
}
// case: sqlite_row_errors
// expect: RowError column 'id': expected string
// expect: RowError column 'note' is null, which its field can't hold; type it 'T | null'
// expect: RowError the row has no column 'missing', which the type reads
// expect: RowError column 'data[0]': expected string
// expect: [ { id: 1, note: null } ]
// A row that doesn't fit the type asked for is a RowError naming the column.
import { Database, RowError, SqliteError } from "sqlite";

async function main(): Promise<void> throws SqliteError | RowError {
  const db = await Database.open(":memory:");
  await db.run("create table t (id integer primary key, note text, data blob)");
  const bytes: u8[] = [1, 2];
  await db.run("insert into t (data) values (?)", [bytes]);
  try {
    await db.query<{ id: string }>("select id from t");
  } catch (e) {
    console.log(e.name, e.message);
  }
  try {
    await db.query<{ note: string }>("select note from t");
  } catch (e) {
    console.log(e.name, e.message);
  }
  try {
    await db.queryOne<{ missing: string }>("select note from t");
  } catch (e) {
    console.log(e.name, e.message);
  }
  try {
    await db.query<{ data: string[] }>("select data from t");
  } catch (e) {
    console.log(e.name, e.message);
  }
  const rows = await db.query<{ id: i64; note: string | null }>("select id, note from t");
  console.log(rows);
}
// case: sqlite_param_types
// error: type 'i32' is not assignable to type 'boolean | number | i64 | null | string | u8[]'
// Parameters are i64, f64, boolean, string, bytes or null; a narrower integer is converted first.
import { Database, SqliteError } from "sqlite";

async function main(): Promise<void> throws SqliteError {
  const db = await Database.open(":memory:");
  const id: i32 = 3;
  await db.run("delete from t where id = ?", [id]);
}
