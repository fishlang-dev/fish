import type { Expr, Stmt } from "./parser.ts";
import { NodeSet, walk } from "./nodes.ts";

// Whether control never reaches the end of these statements. A loop whose condition is
// always true never finishes unless a `break` leaves it.
export function alwaysReturns(stmts: Stmt[], broken: NodeSet<Stmt>, continued: NodeSet<Stmt>): boolean {
  return stmts.some((s) => {
    switch (s.kind) {
      case "return":
      case "throw":
        return true;
      case "if":
        return s.else !== undefined && alwaysReturns(s.then, broken, continued) && alwaysReturns(s.else, broken, continued);
      case "block":
      case "unsafe":
        return alwaysReturns(s.body, broken, continued);
      // Either the block finishes or an error sends control to the catch, so both must leave.
      case "try":
        return (alwaysReturns(s.block, broken, continued) && (!s.handler || alwaysReturns(s.handler, broken, continued)))
          || (s.finalizer !== undefined && alwaysReturns(s.finalizer, broken, continued));
      case "labeled":
        return !broken.has(s) && alwaysReturns([s.body], broken, continued);
      case "while":
        return isTrue(s.cond) && !broken.has(s);
      case "for":
        return (s.test === undefined || isTrue(s.test)) && !broken.has(s);
      case "doWhile":
        // A `continue` skips the rest of the body to test the condition.
        return !broken.has(s) && (isTrue(s.cond) || (alwaysReturns(s.body, broken, continued) && !continued.has(s)));
      case "switch":
        // Every case falls through to the last body, so it decides, provided some case runs.
        return s.cases.some((c) => !c.test) && !broken.has(s) && alwaysReturns(s.cases.at(-1)!.body, broken, continued);
      default:
        return false;
    }
  });
}

const isTrue = (e: Expr) => e.kind === "bool" && e.value;

// The names any assignment, `++` or `--` in these statements writes to.
export function assignedNames(body: Stmt[] | undefined): Set<string> {
  const names = new Set<string>();
  walk("stmt", body, ({ of, node: n }) => {
    if (of !== "expr") return;
    const target = n.kind === "assign" ? n.target : n.kind === "update" ? n.operand : undefined;
    if (target?.kind === "ident") names.add(target.name);
    // A destructuring assignment assigns each name its pattern holds.
    if (n.kind === "destructure") for (const name of patternNames(n.pattern)) names.add(name);
  });
  return names;
}

// Whether these statements assign `name` where it means the binding they start with. A part
// that declares the name again is passed over: a block or function body declaring it, a
// function taking it as a parameter, a loop declaring it in its head, a catch binding it. A
// switch case or other list declaring it is still read whole, which errs toward "assigned".
export function assignsOwn(body: Stmt[], name: string): boolean {
  const declares = (list: unknown[]) => list.some((s) => {
    // An array pattern's holes are missing elements.
    const d = s as { kind?: string; name?: string; declarations?: { target: unknown }[] } | undefined;
    return (d?.kind === "let" && d.declarations!.some((x) => patternNames(x.target).includes(name))) || ((d?.kind === "function" || d?.kind === "class") && d.name === name);
  });
  const visit = (v: unknown): boolean => {
    if (Array.isArray(v)) return !declares(v) && v.some(visit);
    if (typeof v !== "object" || v === null) return false;
    const n = v as { kind?: string; target?: { kind?: string; name?: string }; operand?: { kind?: string; name?: string }; pattern?: unknown; params?: { pattern: unknown }[]; init?: unknown; left?: unknown; param?: unknown };
    if ((n.kind === "assign" && n.target?.kind === "ident" && n.target.name === name) || (n.kind === "update" && n.operand?.kind === "ident" && n.operand.name === name)) return true;
    if (n.kind === "destructure" && patternNames(n.pattern).includes(name)) return true;
    if (Array.isArray(n.params) && n.params.some((p) => patternNames(p.pattern).includes(name))) return false;
    if (n.kind === "for" && n.init && declares([n.init])) return false;
    if ((n.kind === "forOf" || n.kind === "forIn") && ((n.left as { kind?: string }).kind === "let" ? declares([n.left]) : false)) return false;
    return Object.entries(n).some(([k, x]) => !(k === "handler" && n.kind === "try" && patternNames(n.param).includes(name)) && visit(x));
  };
  return body.some(visit);
}

// The variables a destructuring pattern assigns.
function patternNames(p: unknown, names: string[] = []): string[] {
  if (typeof p !== "object" || p === null) return names;
  const q = p as { kind?: string; name?: string; target?: unknown; elements?: unknown[]; props?: { value: unknown }[]; rest?: unknown };
  if (q.kind === "ident") names.push(q.name!);
  else if (q.kind === "default") patternNames(q.target, names);
  else if (q.kind === "array") [...(q.elements ?? []), q.rest].forEach((x) => patternNames(x, names));
  else if (q.kind === "object") [...(q.props ?? []).map((x) => x.value), q.rest].forEach((x) => patternNames(x, names));
  return names;
}
