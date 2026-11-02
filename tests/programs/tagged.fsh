// case: tagged_comptime
// expect: select * from t where a = $1 and b = $2 | bob1 x | 3
// expect: select * from t where a = $1 and b = $2 | bob1 x | 3
// expect: select 1 |  | 1
// expect: count: 2 a, b
// A tag's text is known while compiling: the comptime code over it runs once per template, and
// only the values are handled at run time.
function placeholders(parts: string[]): string {
  let text = parts[0];
  for (let i = 1; i < parts.length; i++) text += "$" + i + parts[i];
  return text;
}
function sql(comptime strings: TemplateStringsArray, ...values: string[]): string {
  const text = comptime placeholders(strings);
  let shown = "";
  for (const v of values) shown += shown === "" ? v : ` ${v}`;
  return `${text} | ${shown} | ${strings.length}`;
}
// A generic tag takes its element type from the values.
function list<T>(comptime strings: TemplateStringsArray, ...items: T[]): string {
  return `${strings[0]}${items.length}`;
}
function main() {
  const name = "bob" + 1;
  for (let i = 0; i < 2; i++) console.log(sql`select * from t where a = ${name} and b = ${"x"}`);
  console.log(sql`select 1`);
  console.log(`${list`count: ${1}${2}`} a, b`);
}
// case: tagged_direct_call
// expect: a
// A tag called directly, its strings an array literal known while compiling.
function sql(comptime strings: TemplateStringsArray, ...values: string[]): string { return strings[0]; }
function main() { console.log(sql(["a"], "x")); }
// case: tagged_first_param
// error: 't' can't be a tag: its first parameter has to be 'comptime strings: TemplateStringsArray'
function t(comptime n: i64, ...values: string[]): string { return "x"; }
function main() { console.log(t`a`); }
// case: tagged_no_values
// error: 'pair' can't be a tag: a tag takes 'comptime strings: TemplateStringsArray, ...values: T[]'
function pair(comptime strings: TemplateStringsArray): string { return strings[0]; }
function main() { console.log(pair`a`); }
// case: tagged_not_function
// error: a tag has to be the name of a top-level function
class Db { query(s: string): string { return s; } }
function main() {
  const db = new Db();
  console.log(db.query`select 1`);
}
// case: tagged_runtime_tag
// error: 'tag' can't be a tag: its first parameter has to be 'comptime strings: TemplateStringsArray'
function tag(strings: TemplateStringsArray, ...values: string[]): string { return strings[0]; }
function main() { console.log(tag`a`); }
// case: tagged_shape
// error: a function with comptime parameters can't take a rest parameter yet, unless it is a tag
function tag(comptime strings: TemplateStringsArray, n: i64, ...values: string[]): string { return strings[0]; }
function main() {}
// case: tagged_sql
// expect: select * from users where name = $1 and age > $2
// expect: 2 params: '; drop table users; -- | 30
// An injection-safe sql tag: the query's text is built while compiling from the template's text
// alone, with a placeholder for each value, so a value can never become part of the query.
class Query {
  text: string;
  params: string[];
  constructor(text: string, params: string[]) {
    this.text = text;
    this.params = params;
  }
}
function placeholders(parts: string[]): string {
  let text = parts[0];
  for (let i = 1; i < parts.length; i++) text += "$" + i + parts[i];
  return text;
}
function sql(comptime strings: TemplateStringsArray, ...values: string[]): Query {
  return new Query(comptime placeholders(strings), values);
}
function main() {
  const name = "'; drop table users; --";
  const q = sql`select * from users where name = ${name} and age > ${String(30)}`;
  console.log(q.text);
  console.log(`${q.params.length} params: ${q.params[0]} | ${q.params[1]}`);
}
// case: tagged_string_like_strings
// expect: a
// expect: strings ["a"]
function t(comptime strings: TemplateStringsArray, ...values: string[]): string { return strings[0]; }
function show(comptime s: string): string { return s; }
function main() {
  console.log(t`a`);
  console.log(show('strings ["a"]'));
}
// case: tagged_unknown
// error: unknown function 'nosuch'
function main() { console.log(nosuch`x`); }
// case: tagged_value_type
// error: type 'i64' is not assignable to type 'string'
function sql(comptime strings: TemplateStringsArray, ...values: string[]): string { return strings[0]; }
function main() { console.log(sql`a = ${1}`); }
// case: tagged_void_arrow
// expect: vt arrow
// expect: vt g
function vt(comptime strings: TemplateStringsArray, ...values: string[]): void { console.log("vt", strings[0]); }
function run(f: () => void) { f(); }
function main() {
  run(() => vt`arrow`);
  const g = () => vt`g`;
  g();
}

// case: tagged_comptime_argument
// expect: a!
function up(comptime s: string): string { return s + "!"; }
function t(comptime strings: TemplateStringsArray, ...v: string[]): string { return strings[0]; }
function main() {
  console.log(up(t`a`));
}
