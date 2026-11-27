// std:query: Kysely-style queries over a type of tables, checked while compiling and compiled to
// parameterized SQL for std:postgres and std:sqlite.
// case: query_select_postgres
// expect: select "id", "name" from "person" where "age" >= $1 and "name" like $2 order by "name" desc limit $3 offset $4
// expect: [ 18, 'A%', 10, 20 ]
import { Kysely } from "std:query";
type DB = { person: { id: i64; name: string; age: i64; note: string | null }; pet: { id: i64; ownerId: i64; species: string } };
function main() {
  const db = new Kysely<DB>({ dialect: "postgres" });
  const q = db.selectFrom("person").select(["id", "name"]).where("age", ">=", 18).where("name", "like", "A%").orderBy("name", "desc").limit(10).offset(20).compile();
  console.log(q.sql);
  console.log(q.parameters);
}

// case: query_select_sqlite
// expect: select "person".* from "person" where "id" = ? [ 1 ]
// SQLite numbers no placeholders, and selectAll gives every column of the table.
import { Kysely } from "std:query";
type DB = { person: { id: i64; name: string; age: i64 } };
function main() {
  const db = new Kysely<DB>({ dialect: "sqlite" });
  const q = db.selectFrom("person").selectAll().where("id", "=", 1).compile();
  console.log(q.sql, q.parameters);
}

// case: query_joins
// expect: select "person"."name", "pet"."species" from "person" inner join "pet" on "pet"."ownerId" = "person"."id" where "pet"."species" = $1 [ 'cat' ]
// expect: select "name", "species" from "person" left join "pet" on "pet"."ownerId" = "person"."id"
// A column is named bare or as table.column, and a row has each under its own name.
import { Kysely } from "std:query";
type DB = { person: { id: i64; name: string }; pet: { id: i64; ownerId: i64; species: string } };
function main() {
  const db = new Kysely<DB>({ dialect: "postgres" });
  const j = db.selectFrom("person").innerJoin("pet", "pet.ownerId", "person.id").select(["person.name", "pet.species"]).where("pet.species", "=", "cat").compile();
  console.log(j.sql, j.parameters);
  const l = db.selectFrom("person").leftJoin("pet", "pet.ownerId", "person.id").select(["name", "species"]).compile();
  console.log(l.sql);
}

// case: query_writes
// expect: insert into "person" ("age", "name") values ($1, $2), ($3, $4) [ 30, 'Ann', 4, 'Bo' ]
// expect: update "person" set "age" = ?, "note" = ? where "name" = ? [ 31, null, 'Ann' ]
// expect: delete from "pet" where "species" <> $1 [ 'dog' ]
// A field an inserted row leaves out is the column's default, and the columns are in the order of
// the row's type; setColumn can set null.
import { Kysely } from "std:query";
type DB = { person: { id: i64; name: string; age: i64; note: string | null }; pet: { id: i64; species: string } };
function main(): void throws TypeError {
  const pg = new Kysely<DB>({ dialect: "postgres" });
  const lite = new Kysely<DB>({ dialect: "sqlite" });
  const i = pg.insertInto("person").values({ name: "Ann", age: 30 }).values({ name: "Bo", age: 4 }).compile();
  console.log(i.sql, i.parameters);
  const u = lite.updateTable("person").set({ age: 31 }).setColumn("note", null).where("name", "=", "Ann").compile();
  console.log(u.sql, u.parameters);
  const d = pg.deleteFrom("pet").where("species", "<>", "dog").compile();
  console.log(d.sql, d.parameters);
}

// case: query_sqlite_rows
// expect: Ann cat
// expect: Bo null
// expect: 2
// A compiled query runs on std:sqlite's Database, its rows typed by what it selected: a left
// join's columns may be null.
import { Kysely } from "std:query";
import { Database, RowError, SqliteError } from "std:sqlite";
type DB = { person: { id: i64; name: string }; pet: { id: i64; ownerId: i64; species: string } };
async function main(): Promise<void> throws SqliteError | RowError | TypeError {
  const sqlite = await Database.open(":memory:");
  await sqlite.run("create table person (id integer primary key, name text not null)");
  await sqlite.run("create table pet (id integer primary key, ownerId integer not null, species text not null)");
  const db = new Kysely<DB>({ dialect: "sqlite" });
  const people = db.insertInto("person").values({ id: 1, name: "Ann" }).values({ id: 2, name: "Bo" }).compile();
  await sqlite.executeQuery(people);
  const pets = db.insertInto("pet").values({ ownerId: 1, species: "cat" }).compile();
  await sqlite.executeQuery(pets);
  const owners = db.selectFrom("person").leftJoin("pet", "pet.ownerId", "person.id").select(["person.name", "pet.species"]).orderBy("person.name").compile();
  const rows = await sqlite.executeQuery(owners);
  for (const r of rows) {
    const species: string | null = r.species;
    console.log(r.name, species);
  }
  console.log(rows.length);
}

// case: query_unknown_table
// error: does not satisfy the constraint '"person"'
import { Kysely } from "std:query";
type DB = { person: { id: i64 } };
function main() {
  const db = new Kysely<DB>({ dialect: "postgres" });
  console.log(db.selectFrom("people").compile().sql);
}

// case: query_unknown_column
// error: does not satisfy the constraint '"id" | "name" | "person.id" | "person.name"'
import { Kysely } from "std:query";
type DB = { person: { id: i64; name: string } };
function main() {
  const db = new Kysely<DB>({ dialect: "postgres" });
  console.log(db.selectFrom("person").select(["id", "email"]).compile().sql);
}

// case: query_wrong_value
// error: is not assignable to parameter of type 'i64'
import { Kysely } from "std:query";
type DB = { person: { id: i64; name: string } };
function main() {
  const db = new Kysely<DB>({ dialect: "postgres" });
  console.log(db.selectFrom("person").where("id", "=", "7").compile().sql);
}
