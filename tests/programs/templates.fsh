// mode: parse
function f() {
  let plain = `no substitutions`
  let simple = `a ${b} c`
  let many = `${a}${b}${c}`
  let nested = `outer ${`inner ${deep} inner`} outer`
  let escapes = `\` \${ not a substitution A \n`
  let multiline = `line one
line two`
  let tagged = sql`select * from users where id = ${id}`
  let chained = tag.member`x`
}
type Route = `/users/${string}` | `/posts/${Id}/comments`
type Shout<S extends string> = `${Uppercase<S>}!`
