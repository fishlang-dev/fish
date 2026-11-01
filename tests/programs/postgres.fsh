// The postgres module's checks that need no server; tests/postgres.test.ts talks to servers.
// case: postgres_url_refusals
// expect: TypeError: the Postgres URL can't be read as a URL: Invalid URL
// expect: TypeError: a Postgres URL starts with postgres:// or postgresql://, not mysql:
// expect: TypeError: sslmode is 'disable', 'require' or 'verify-full', not 'prefer'
// expect: TypeError: max, the pool's size, is a whole number of at least 1, not '0'
// expect: TypeError: max, the pool's size, is a whole number of at least 1, not 'ten'
// expect: IoError: can't connect: Connection refused
// A URL Pool.connect can't use is a TypeError before any connection; the module is reached as
// the global postgres too.
async function attempt(url: string) {
  try {
    const _pool = await postgres.Pool.connect(url);
    console.log("connected");
  } catch (e) {
    if (e instanceof TypeError) console.log("TypeError:", e.message);
    else if (e instanceof IoError) console.log("IoError:", e.message);
    else console.log("other:", e.message);
  }
}

async function main(): Promise<void> throws IoError {
  let free: i64 = 0;
  {
    const closed = await TcpListener.bind("127.0.0.1", 0);
    free = closed.port;
  }
  await attempt("not a url");
  await attempt("mysql://localhost/db");
  await attempt("postgres://localhost/db?sslmode=prefer");
  await attempt("postgres://localhost/db?max=0");
  await attempt("postgres://localhost/db?max=ten");
  await attempt("postgres://u@127.0.0.1:" + String(free) + "/db");
}
// case: postgres_param_types
// error: type 'i32' is not assignable to type 'boolean | number | i64 | null | string | u8[] | Date'
// Parameters are i64, f64, boolean, string, bytes, a Date or null; a narrower integer is
// converted first.
import { Pool, PostgresError } from "postgres";

async function main(): Promise<void> throws IoError | AbortError | TypeError | PostgresError {
  const pool = await Pool.connect("postgres://localhost/db");
  const id: i32 = 3;
  await pool.execute("delete from t where id = $1", [id]);
}
// case: postgres_row_needs_json
// error: values of type 'Plain' can't be read from JSON: a class is read from JSON when it has '@derive(Json)'
// Rows are read into object types, or classes with @derive(Json).
import { Pool, PostgresError, RowError } from "postgres";

class Plain { x: i64 = 0; }

async function main(): Promise<void> throws IoError | AbortError | TypeError | PostgresError | RowError {
  const pool = await Pool.connect("postgres://localhost/db");
  const rows = await pool.query<Plain>("select 1 as x");
  console.log(rows.length);
}
