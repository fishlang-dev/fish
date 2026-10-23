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
