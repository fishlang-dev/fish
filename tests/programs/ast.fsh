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
