import type { Expr, Stmt } from "./parser.ts";

// Whether control never reaches the end of these statements. A loop whose condition is
// always true never finishes unless a `break` leaves it.
export function alwaysReturns(stmts: Stmt[], broken: Set<Stmt>, continued: Set<Stmt>): boolean {
  return stmts.some((s) => {
    switch (s.kind) {
      case "return":
      case "throw":
        return true;
      case "if":
        return s.else !== undefined && alwaysReturns(s.then, broken, continued) && alwaysReturns(s.else, broken, continued);
      case "block":
        return alwaysReturns(s.body, broken, continued);
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
export function assignedNames(node: unknown, names = new Set<string>()): Set<string> {
  if (typeof node !== "object" || node === null) return names;
  if (Array.isArray(node)) {
    node.forEach((n) => assignedNames(n, names));
    return names;
  }
  const n = node as { kind?: string; target?: { kind?: string; name?: string }; operand?: { kind?: string; name?: string } };
  const target = n.kind === "assign" ? n.target : n.kind === "update" ? n.operand : undefined;
  if (target?.kind === "ident") names.add(target.name!);
  Object.values(node).forEach((v) => assignedNames(v, names));
  return names;
}
