// error: a tag has to be the name of a top-level function
class Db { query(s: string): string { return s; } }
function main() {
  const db = new Db();
  console.log(db.query`select 1`);
}
