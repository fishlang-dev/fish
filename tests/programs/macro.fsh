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
// error: the macro 'two' takes 1 argument after what it is applied to, but this gives 0
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
// case: macro_h1b_ident_binding_silent
// expect: 5
const total: i64 = 99;
macro function m(input: AstStmt): Ast[] {
  if (input.kind === "function") {
    const body = input.body.clone();
    if (body !== null) {
      const ret = body[0].clone();
      if (ret.kind === "return") {
        const v = ret.value;
        if (v !== null) return [
          quote`function ${ident("withTotal")}(): i64 { const ${ident("total")}: i64 = 5; return ${v.clone()}; }`,
          quote`function other(): i64 { const total: i64 = 1; return total; }`,
        ];
      }
    }
  }
  return [input];
}
@m function g(): i64 { return total; }
function main() {
  console.log(withTotal());
}
// case: macro_h19_match_binding_capture
// expect: 10
const v: i64 = 10;
macro function wrap(input: AstStmt): Ast[] {
  if (input.kind === "function") {
    const body = input.body.clone();
    if (body !== null) {
      const ret = body[0].clone();
      if (ret.kind === "return") {
        const e = ret.value;
        if (e !== null) return [quote`function ${ident("w")}(o: i64): i64 { return match (o) { case v => ${e.clone()}, }; }`];
      }
    }
  }
  return [input];
}
@wrap function g(): i64 { return v; }
function main() {
  console.log(w(5));
}
// case: macro_h18_this_param
// expect: 2
macro function m(input: AstStmt): Ast[] {
  return [input,
    quote`class ${ident("Counter")} { n: i64 = 1; inc(this: Mut<this>) { this.n = this.n + 1; } }`];
}
@m function f() {}
function main() {
  let c = new Counter();
  c.inc();
  console.log(c.n);
}
// case: macro_h2_shorthand
// expect: 1 2
type P = { x: i64; y: i64 };
macro function m(input: AstStmt): Ast[] {
  return [input, quote`function ${ident("make")}(): P { const x = 1; return { x, y: 2 }; }`];
}
@m function f() {}
function main() {
  const p = make();
  console.log(p.x, p.y);
}
// case: macro_h21_type_param_capture
// expect: hello
type T = string;
macro function wrap(input: AstStmt): Ast[] {
  if (input.kind === "function") {
    const r = input.returnType.clone();
    if (r !== null) return [input, quote`function ${ident("keepFirst")}<T>(a: ${r.clone()}, b: T): ${r.clone()} { return a; }`];
  }
  return [input];
}
@wrap function g(): T { return "x"; }
function main() {
  console.log(keepFirst("hello", 5));
}
// case: macro_h3_helper_quote
// expect: 42 1
function build(): AstStmt {
  return quote`function helper(): i64 { return 41; }`;
}
macro function m(input: AstStmt): Ast[] {
  return [input, build(), quote`function ${ident("answer")}(): i64 { return helper() + 1; }`];
}
function helper(): i64 { return 1; }
@m function f() {}
function main() {
  console.log(answer(), helper());
}
// case: macro_s3e_macro_local_type
// expect: 3
macro function m(input: Ast): Ast[] {
  type Name = string;
  const n: Name = "three";
  return [input, quote`function ${ident(n)}(): i64 { return 3; }`];
}
@m function f() {}
function main() {
  console.log(three());
}
// case: macro_e2_export_const
// expect: 3
macro function withConst(input: AstStmt): Ast[] {
  return [input, quote`const ${ident("THREE")}: i64 = 3;`];
}
@withConst export function f() {}
function main() { console.log(THREE); }
// case: macro_parameter_type
// error: a macro's parameter takes the declaration it is applied to, so its type is 'Ast' or 'AstStmt'
macro function m(input: AstExpr): Ast {
  return input;
}
@m function f() {}
function main() {}
// case: macro_generic
// error: a macro takes no type parameters
macro function m<T>(input: Ast): Ast {
  return input;
}
function main() {}
// case: macro_result_type
// error: a macro gives the declarations it makes, as an 'Ast' or an 'Ast[]', not 'i64'
macro function m(input: Ast): i64 {
  return 1;
}
@m function f() {}
function main() {}
// case: macro_user_ast_name
// expect: num
type AstExpr = { kind: "num" };
function main() {
  const e: AstExpr = { kind: "num" };
  console.log(e.kind);
}
// case: macro_two_quotes_local
// expect: 7 9
const y: i64 = 9;
macro function m(input: AstStmt): Ast[] {
  const decl = quote`const y: i64 = 7;`;
  return [input, quote`function ${ident("seven")}(): i64 { ${decl}; return y; }`];
}
@m function f() {}
function main() {
  console.log(seven(), y);
}
// case: macro_cap_match_binding
// expect: 10
const V: i64 = 10;
macro function wrap(input: AstStmt): Ast[] {
  if (input.kind === "function") {
    const body = input.body.clone();
    if (body !== null) {
      const ret = body[0].clone();
      if (ret.kind === "return") {
        const e = ret.value;
        if (e !== null) return [quote`function ${ident("w")}(o: i64): i64 { return match (o) { case V => ${e.clone()}, }; }`];
      }
    }
  }
  return [input];
}
@wrap function g(): i64 { return V; }
function main() {
  console.log(w(5));
}
// case: macro_same_start
// expect: x x
macro function sufA(input: AstStmt): AstStmt { let d = input; if (d.kind === "function") d.name = `${d.name}A`; return d; }
macro function sufB(input: AstStmt): AstStmt { let d = input; if (d.kind === "function") d.name = `${d.name}B`; return d; }
function make(dec: AstExpr, name: string): AstStmt {
  return quote`@${dec} function ${ident(name)}(): string { return "x"; }`;
}
macro function two(input: AstStmt): Ast[] {
  return [make(ident("sufA"), "a"), make(ident("sufB"), "b")];
}
@two function f() {}
function main() { console.log(aA(), bB()); }
// case: macro_quoted_top_const
// expect: 10
macro function m(input: AstStmt): Ast[] {
  return [input, quote`const LIMIT: i64 = 10;`, quote`function ${ident("limit")}(): i64 { return LIMIT; }`];
}
@m function f() {}
function main() {
  console.log(limit());
}
// case: macro_declare_single
// expect: 3
macro function withAbs(input: AstStmt): Ast[] {
  return [input, quote`declare function labs(x: i64): i64;`, quote`function ${ident("absOf")}(x: i64): i64 { return unsafe { labs(x) }; }`];
}
@withAbs function f() {}
function main() { console.log(absOf(-3)); }
// case: macro_quoted_const_export_single
// expect: 1
macro function m(input: AstStmt): Ast[] {
  return [input, quote`export function base(): i64 { return 1; }`, quote`function ${ident("viaBase")}(): i64 { return base(); }`];
}
@m function f() {}
function main() { console.log(viaBase()); }
// case: macro_other_macro_declares
// expect: 1 user
function helper(): string { return "user"; }
macro function a(input: AstStmt): Ast[] {
  return [input, quote`function helper(): i64 { return 1; }`, quote`function ${ident("viaA")}(): i64 { return helper(); }`];
}
macro function b(input: AstStmt): Ast[] {
  return [input, quote`function ${ident("viaB")}(): string { return helper(); }`];
}
@a function f() {}
@b function g() {}
function main() {
  console.log(viaA(), viaB());
}
// case: macro_main_ref
// expect: ok
macro function m(input: AstStmt): Ast[] {
  return [input, quote`function ${ident("again")}(): i64 { if (false) main(); return 1; }`];
}
@m function f() {}
function main() { console.log("ok"); }
// case: macro_stacked_pins_single
// expect: 1 base
function label(): string { return "base"; }
macro function keep(input: Ast): Ast { return input; }
macro function withLabel(input: AstStmt): Ast[] {
  return [input, quote`function ${ident("described")}(): string { return label(); }`];
}
@keep @withLabel function one(): i64 { return 1; }
function main() { console.log(one(), described()); }
// case: macro_bare_variant
// expect: 7 0
enum Opt { Has(i64), Nothing }
macro function m(input: AstStmt): Ast[] {
  return [input, quote`function ${ident("get")}(o: Opt): i64 { return match (o) { case Nothing => 0, case Has(v) => v, }; }`];
}
@m function f() {}
function main() { console.log(get(Opt.Has(7)), get(Opt.Nothing)); }
// case: macro_cross_quote_scope
// expect: 9
const value: i64 = 3;
macro function m(input: AstStmt): Ast[] {
  return [input,
    quote`function ${ident("sq")}(value: i64): i64 { return value * value; }`,
    quote`function ${ident("show")}(): i64 { return sq(value); }`];
}
@m function f() {}
function main() {
  console.log(show());
}
// case: macro_scope_through_clone
// expect: 7 7 9
const y: i64 = 9;
macro function seven(input: AstStmt): Ast[] {
  const decl = quote`const y = 7;`;
  return [input, quote`function ${ident("sevenA")}(): i64 { ${decl.clone()}; return y; }`, quote`function ${ident("sevenB")}(): i64 { ${decl}; return y; }`];
}
@seven function f() {}
function main() {
  console.log(sevenA(), sevenB(), y);
}
// case: macro_outer_param_in_inner
// expect: 5
macro function m(input: AstStmt): Ast[] {
  const body = quote`return x;`;
  return [input, quote`function ${ident("id")}(x: i64): i64 { ${body}; }`];
}
@m function f() {}
function main() { console.log(id(5)); }
// case: macro_outer_param_inner_pinned
// expect: 5
const x: i64 = 99;
macro function m(input: AstStmt): Ast[] {
  const body = quote`return x;`;
  return [input, quote`function ${ident("id")}(x: i64): i64 { ${body}; }`];
}
@m function f() {}
function main() { console.log(id(5)); }
// case: macro_helper_twice
// expect: 7 8
function decl(): AstStmt { return quote`const total: i64 = 7;`; }
macro function m(input: AstStmt): Ast[] {
  return [input,
    quote`function ${ident("seven")}(): i64 { ${decl()}; return total; }`,
    quote`function ${ident("eight")}(): i64 { ${decl()}; return total + 1; }`];
}
@m function f() {}
function main() { console.log(seven(), eight()); }
// case: macro_nested_two_levels
// expect: 7
macro function m(input: AstStmt): Ast[] {
  const inner = quote`const total: i64 = 7;`;
  const block = quote`if (true) { ${inner}; console.log(total); }`;
  return [input, quote`function ${ident("show")}() { ${block}; }`];
}
@m function f() {}
function main() { show(); }
// case: macro_arguments
// expect: 6 3 b
const BASE = 2;
macro function times(input: AstStmt, factor: i64, label: string, extra: AstExpr): Ast[] {
  const n = ident(label);
  const lit: AstExpr = { kind: "int", value: factor, start: 0, end: 0 };
  return [input, quote`function ${n}(): i64 { return ${extra} * ${lit}; }`];
}
macro function named(input: AstStmt, name: string): Ast[] {
  return [input, quote`function ${ident(name)}(): string { return "b"; }`];
}
@times(BASE + 1, "six", 2) function f() {}
@times(1, "three", 1 + 2) @named("bee") function g() {}
function main() {
  console.log(six(), three(), bee());
}
// case: macro_argument_count
// error: the macro 'named' takes 1 argument after what it is applied to, but this gives 2
macro function named(input: AstStmt, name: string): Ast {
  return input;
}
@named("a", "b") function f() {}
function main() {}
// case: macro_argument_type
// error: this argument is a 'i64', but the macro 'named' takes 'name' as a 'string'
macro function named(input: AstStmt, name: string): Ast {
  return input;
}
@named(1) function f() {}
function main() {}
