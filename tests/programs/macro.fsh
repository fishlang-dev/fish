// case: macro_keep_and_add
// expect: 1 2 3
macro function keep(input: Ast): Ast {
  return input;
}
macro function withExtra(input: AstStmt): Ast[] {
  return [input, quote`function ${ident("extra")}(): i64 { return 2; }`];
}
@keep function one(): i64 { return 1; }
@withExtra function three(): i64 { return 3; }
function main() {
  console.log(one(), extra(), three());
}
// case: macro_rename
// expect: 7 renamed
macro function rename(input: AstStmt): AstStmt {
  let d = input;
  if (d.kind === "function") d.name = `${d.name}Renamed`;
  return d;
}
@rename function seven(): i64 { return 7; }
@rename export function named(): string { return "renamed"; }
function main() {
  console.log(sevenRenamed(), namedRenamed());
}
// case: macro_on_types_and_classes
// expect: 3 point
macro function described(input: Ast): Ast[] {
  if (input.kind === "class") return [input, quote`function ${ident("describe")}(): string { return "point"; }`];
  return [input];
}
macro function keep(input: Ast): Ast {
  return input;
}
@keep type Id = i64;
@keep interface Named { name: string }
@keep enum Color { Red, Green }
@described @keep class Point { x: i64 = 3; }
function main() {
  const id: Id = new Point().x;
  console.log(id, describe());
}
// case: macro_helpers_and_nested
// expect: 4
function count(): i64 {
  return 4;
}
macro function counted(input: Ast): Ast[] {
  const n = count();
  return n > 0 ? [input, quote`function ${ident("four")}(): i64 { return 4; }`] : [input];
}
macro function addsDecorated(input: Ast): Ast[] {
  return [input, quote`@counted function helper() {}`];
}
@addsDecorated function base() {}
function main() {
  console.log(four());
}
// case: macro_unknown
// error: 'nope' isn't a macro; a decorator applies a 'macro function nope(input: Ast): Ast'
@nope function f() {}
function main() {}
// case: macro_not_a_declaration
// error: the macro 'bad' gave a 'binary', but a macro gives declarations that can stand at the top level
macro function bad(input: Ast): Ast {
  return quote`1 + 2`;
}
@bad function f() {}
function main() {}
// case: macro_panics
// error: this comptime code panicked
macro function fails(input: Ast): Ast {
  const xs: i64[] = [];
  const x = xs[3];
  return input;
}
@fails function f() {}
function main() {}
// case: macro_uses_expansion
// error: the macro 'm' uses 'made', which a macro makes or changes; a macro can't depend on an expansion
macro function keep(input: Ast): Ast {
  return input;
}
@keep function made(): i64 { return 1; }
macro function m(input: Ast): Ast {
  const n = made();
  return input;
}
@m function f() {}
function main() {}
// case: macro_called
// error: 'keep' is a macro, applied to a declaration as '@keep'; it isn't called as a function
macro function keep(input: Ast): Ast {
  return input;
}
function main() {
  keep(quote`1`);
}
// case: macro_shape
// error: a macro takes one parameter, the declaration it is applied to
macro function two(a: Ast, b: Ast): Ast {
  return a;
}
@two function f() {}
function main() {}
// case: macro_nested_declaration
// error: a macro applies to a top-level declaration
macro function keep(input: Ast): Ast {
  return input;
}
function main() {
  @keep function inner() {}
}
// case: macro_hygiene
// expect: 42 1 5
macro function counted(input: AstStmt): Ast[] {
  const name = input.kind === "function" ? `${input.name}Count` : "count";
  return [
    input,
    quote`function helper(): i64 { const total = 40; return total; }`,
    quote`function ${ident(name)}(): i64 { return helper() + 2; }`,
  ];
}
function helper(): i64 { return 1; }
@counted function items() {}
function main() {
  const total = 5;
  console.log(itemsCount(), helper(), total);
}
// case: macro_hygiene_private
// error: unknown function 'secret'
macro function withSecret(input: AstStmt): Ast[] {
  return [input, quote`function secret(): i64 { return 1; }`];
}
@withSecret function f() {}
function main() {
  console.log(secret());
}
