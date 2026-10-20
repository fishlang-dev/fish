import type { Expr, Stmt } from "./parser.ts";

// Whether control never reaches the end of these statements. A loop whose condition is
// always true never finishes unless a `break` leaves it.
export function alwaysReturns(stmts: Stmt[], broken: Set<Stmt>, continued: Set<Stmt>): boolean {
  return stmts.some((s) => {
    switch (s.kind) {
      case "return":
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
