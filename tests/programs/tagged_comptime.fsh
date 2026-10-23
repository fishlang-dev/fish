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
