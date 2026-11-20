// The generated tree walkers, rebuild and macro reader, and that each is current with the parser's
// AST types.
import { join } from "node:path";
import { parserSource } from "../../scripts/gen/ast.fsh";
import { unquoteSource } from "../../scripts/gen/unquotegen.fsh";
import { walkSources } from "../../scripts/gen/walkgen.fsh";
import { forEachChild, Rewrites, walkWhile, type AnyNode } from "../../src/nodes.fsh";
import { parseExpression, type Expr } from "../../src/parser.fsh";
import { rebuiltExpr } from "../../src/rebuild.fsh";
import { read, root, same } from "./support.fsh";

function kindOf(n: Ref<AnyNode>): string {
  if (n.of === "expr") return n.node.kind;
  if (n.of === "typeNode") return n.node.kind;
  return "";
}

function parsed(src: string): Expr {
  try {
    return parseExpression(src, { last: 0 });
  } catch (e) {
    assert(false, `${src}: ${e.message}`);
    return { id: 0, kind: "ident", name: "", start: 0, end: 0 };
  }
}

function childrenOf(n: AnyNode): string[] {
  let found: string[] = [];
  forEachChild(n, (c) => {
    found.push(c.of === "stmts" ? "stmts" : `${c.of} ${kindOf(c)}`);
  });
  return found;
}

test("children come in the order their type lists the fields, each list of statements whole", () => {
  const e = parsed("f<T>(a, () => { g(); })");
  const got = childrenOf({ of: "expr", node: e }).join(", ");
  assert(got === "expr ident, typeNode ref, expr ident, expr arrow", got);
  if (e.kind !== "call") {
    assert(false, "not a call");
    return;
  }
  const arrow: Ref<Expr> = e.args[1];
  const under = childrenOf({ of: "expr", node: arrow }).join(", ");
  assert(under === "stmts", under);
  // A walk goes through a list without handing it over, and skips what is under a node it refuses.
  let kinds: string[] = [];
  walkWhile({ of: "expr", node: e }, (n) => {
    const kind = kindOf(n);
    kinds.push(kind);
    return kind !== "arrow";
  });
  assert(kinds.join(", ") === "call, ident, ref, ident, arrow", kinds.join(", "));
});

test("a rebuild puts each replacement where its node was, under that node's id, replacements within replacements too", () => {
  const e = parsed("f(a, g(b))");
  if (e.kind !== "call") {
    assert(false, "not a call");
    return;
  }
  const a: Ref<Expr> = e.args[0];
  const inner: Ref<Expr> = e.args[1];
  if (inner.kind !== "call") {
    assert(false, "not a call");
    return;
  }
  let r = new Rewrites();
  const by = r.replace(inner, { id: 0, kind: "call", callee: inner.callee.clone(), typeArgs: inner.typeArgs.clone(), args: inner.args.clone(), optional: inner.optional, start: inner.start, end: inner.end });
  const b: Ref<Expr> = inner.args[0];
  if (b.kind !== "ident") {
    assert(false, "not a name");
    return;
  }
  const c = r.replace(b, { id: 0, kind: "ident", name: "c", start: 0, end: 0 });
  assert(r.current(inner.clone()) === by, "the replacement isn't what the table gives for the node");
  assert(by.id === inner.id, `the replacement has id ${by.id}, not ${inner.id}`);
  const id = e.id;
  const kept = a.clone();
  const rebuilt = rebuiltExpr(e.clone(), r);
  assert(rebuilt.id === id && rebuilt.kind === "call", "the rebuild isn't the call it was given");
  if (rebuilt.kind !== "call" || by.kind !== "call") return;
  assert(rebuilt.args.length === 2 && rebuilt.args[0] === kept, "the rebuild changed the first argument");
  const placed: Ref<Expr> = rebuilt.args[1];
  if (placed.kind !== "call") {
    assert(false, "the replacement isn't in place");
    return;
  }
  assert(placed.id === inner.id, `the replacement in place has id ${placed.id}, not ${inner.id}`);
  assert(placed.args.length === 1 && placed.args[0] === c, "the replacement within the replacement isn't in place");
  assert(placed.callee === by.callee && placed.typeArgs === by.typeArgs, "the replacement in place isn't the one made");
});

test("the walkers and the rebuild are generated from the parser's current AST types; run 'fishc run scripts/walkgen.fsh' when they aren't", () => {
  try {
    const both = walkSources(parserSource());
    same(read(join(root(), "src", "walk.fsh")), both[0]!, "src/walk.fsh");
    same(read(join(root(), "src", "rebuild.fsh")), both[1]!, "src/rebuild.fsh");
  } catch (e) {
    assert(false, e.message);
  }
});

test("the Ast reader macros' results go through is generated from the parser's current AST types; run 'fishc run scripts/unquotegen.fsh' when it isn't", () => {
  try {
    same(read(join(root(), "src", "unquote.fsh")), unquoteSource(parserSource()), "src/unquote.fsh");
  } catch (e) {
    assert(false, e.message);
  }
});
