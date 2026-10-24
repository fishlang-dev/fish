// case: ast_walk
// expect: 5 3
function count(e: Ref<AstExpr>): i64 {
  if (e.kind === "binary") return 1 + count(e.left) + count(e.right);
  if (e.kind === "int") return 1;
  return 100;
}
function returns(s: AstStmt): i64 {
  if (s.kind === "function") {
    let n = 0;
    const body = s.body;
    if (body !== null) for (const t of body) if (t.kind === "return") n++;
    return n;
  }
  return -1;
}
const N = comptime count({
  kind: "binary", op: "+", start: 0, end: 9,
  left: { kind: "int", value: 1, start: 0, end: 1 },
  right: { kind: "binary", op: "*", start: 4, end: 9, left: { kind: "int", value: 2, start: 4, end: 5 }, right: { kind: "int", value: 3, start: 8, end: 9 } },
});
const R = comptime returns({
  kind: "function", name: "f", async: false, generator: false, macro: false, typeParams: [], params: [], returnType: null, start: 0, end: 0,
  body: [
    { kind: "return", value: null, start: 0, end: 0 },
    { kind: "if", cond: { kind: "bool", value: true, start: 0, end: 0 }, then: [], else: null, start: 0, end: 0 },
    { kind: "return", value: null, start: 0, end: 0 },
    { kind: "return", value: null, start: 0, end: 0 },
  ],
});
function main() {
  console.log(N, R);
}
// case: ast_names
// expect: AstExpr
// expect: 2
function main() {
  const e: Ast = { kind: "null", start: 0, end: 4 };
  const kinds: AstType[] = [{ kind: "ref", name: "i64", args: [], start: 0, end: 3 }, { kind: "array", element: { kind: "ref", name: "string", args: [], start: 0, end: 6 }, start: 0, end: 8 }];
  const p: AstPattern = { kind: "wildcard", start: 0, end: 1 };
  console.log(e.kind === "null" ? "AstExpr" : "other");
  console.log(kinds.length);
}
// case: ast_quote
// expect: binary 5 let ref function 2 let Map 2
// expect: a binary true
// expect: function class block object
function count(e: Ref<AstExpr>): i64 {
  if (e.kind === "binary") return 1 + count(e.left) + count(e.right);
  if (e.kind === "call") return 1 + (e.args.length as i64);
  return 1;
}
function kinds(): string {
  const x = quote`b * 2`;
  const sum = quote`a + ${x}`;
  const s = quote`const y = ${sum.clone()};`;
  const t = quoteType`Map<string, ${quoteType`i64[]`}>`;
  const f = quote`function g() { ${s.clone()}; return 1; }`;
  let out = `${sum.kind} ${count(sum)} ${s.kind} ${t.kind} ${f.kind}`;
  if (f.kind === "function") {
    const body = f.body;
    if (body !== null) out = out + ` ${body.length} ${body[0].kind}`;
  }
  if (t.kind === "ref") out = out + ` ${t.name} ${t.args.length}`;
  return out;
}
function parts(): string {
  const e = quote`a + ${quote`b * 2`}`;
  if (e.kind !== "binary") return "";
  const left = e.left;
  const right = e.right;
  const name = left.kind === "ident" ? left.name : "";
  return `${name} ${right.kind} ${e.start < e.end}`;
}
function forms(): string {
  const d = quote`function f() {}`;
  const c = quote`class C {}`;
  const b = quote`{ a; }`;
  const o = quote`({ a: 1 })`;
  return `${d.kind} ${c.kind} ${b.kind} ${o.kind}`;
}
const K = comptime kinds();
const P = comptime parts();
const F = comptime forms();
function main() {
  console.log(K);
  console.log(P);
  console.log(F);
}
// case: ast_quote_wrong_splice
// error: a splice where an expression goes takes an 'AstExpr', not 'AstStmt'
function make(): string {
  const s = quote`return 1;`;
  const e = quote`a + ${s}`;
  return e.kind;
}
const K = comptime make();
function main() {
  console.log(K);
}
// case: ast_quote_name_splice
// expect: function made x
function make(): string {
  const n = ident("made");
  const f = quote`function ${n}() { const ${ident("x")} = 1; }`;
  let out: string = f.kind;
  if (f.kind === "function") {
    out = `${out} ${f.name}`;
    const body = f.body;
    if (body !== null) {
      const first = body[0].clone();
      if (first.kind === "let") {
        const target = first.declarations[0].target.clone();
        if (target.kind === "ident") out = `${out} ${target.name}`;
      }
    }
  }
  return out;
}
const K = comptime make();
function main() {
  console.log(K);
}
// case: ast_quote_name_not_ident
// error: a splice where a name goes takes an identifier
function make(): string {
  const f = quote`function ${quote`1 + 2`}() {}`;
  return f.kind;
}
const K = comptime make();
function main() {
  console.log(K);
}
// case: ast_quote_parse
// error: this quote's text doesn't parse
function make(): string {
  return quote`a +`.kind;
}
const K = comptime make();
function main() {
  console.log(K);
}
// case: ast_quote_many
// error: a quote holds one expression, statement or declaration, not 2
function make(): string {
  return quote`a; b;`.kind;
}
const K = comptime make();
function main() {
  console.log(K);
}
// case: ast_quote_at_run_time
// panic: a quote builds syntax while compiling, so it can't run in the program
function main() {
  const e = quote`1 + 2`;
  console.log(e.kind);
}
// case: ast_quote_repairs
// expect: \d+ a\nb
// expect: function class expr binary
// expect: y 1
function texts(): string {
  const r = quote`/\d+/g`;
  const s = quote`"a\nb"`;
  const pattern = r.kind === "regex" ? r.pattern : "";
  const raw = s.kind === "string" && s.value === "a\nb" ? "a\\nb" : "wrong";
  return `${pattern} ${raw}`;
}
function twice(): AstExpr {
  return quote`x * 2`;
}
function forms(): string {
  const d = quote`/* doc */ function f() {}`;
  const c = quote`// a helper
class C {}`;
  const e = quote`a + 1`;
  const s = quote`${e};`;
  return `${d.kind} ${c.kind} ${s.kind} ${twice().kind}`;
}
function spliced(): string {
  const n = quote`y`;
  const q = quote`f(${n.clone()}, 1)`;
  const name = n.kind === "ident" ? n.name : "";
  return `${name} ${q.kind === "call" ? q.args.length - 1 : 0}`;
}
const T = comptime texts();
const F = comptime forms();
const S = comptime spliced();
function main() {
  console.log(T);
  console.log(F);
  console.log(S);
}
// case: ast_quote_moves
// error: 'e' was moved, so it can't be used here
function make(): string {
  const e = quote`a`;
  const q = quote`${e} * ${e}`;
  return q.kind;
}
const K = comptime make();
function main() {
  console.log(K);
}
// case: ast_quote_big_integer
// error: an Ast holds an integer as an 'i64', which can't hold
function make(): string {
  return quote`123456789012345678901234567890n`.kind;
}
const K = comptime make();
function main() {
  console.log(K);
}
// case: ast_quote_decorated
// expect: class
function make(): string {
  return quote`@sealed class D {}`.kind;
}
const K = comptime make();
function main() {
  console.log(K);
}
