// Which of a function's parameters take a closure its body does nothing with but call, and the
// closure a call through one runs. Instances of a function that differ only in such closures are
// one function to codegen and one check to the checker, so both decide it here.
import { bodyOf, type Arenas, type InstanceId } from "./arenas.fsh";
import { walk, walkWhile } from "./nodes.fsh";
import { type Typing } from "./typing.fsh";

// The parameters of a plain function holding a closure that its body only calls, or hands on
// to the same function at the same place; one read anywhere else, a nested function's included,
// is used some other way.
export function callbacksOnlyCalled(arenas: Ref<Arenas>, typing: Ref<Typing>, i: InstanceId): Set<usize> {
  const b = bodyOf(arenas, arenas.instanceOf(i));
  let at = new Set<usize>();
  if (b.self !== undefined || b.closure !== undefined || b.generator === true || b.async === true || b.foreign === true || b.rust !== undefined || b.js !== undefined || b.exported === true || b.comptime !== undefined || arenas.instanceOf(i).symbol === "main") return at;
  if (b.params.some((p) => p.comptime || p.rest)) return at;
  let kAt: usize = 0;
  for (const p of b.params) {
    const k = kAt;
    kAt++;
    if (p.pattern.kind !== "ident" || p.optional || p.default !== undefined) continue;
    const get2 = arenas.instanceOf(i).locals.get(p)!;
    const part = arenas.localOf(get2).type;
    if (typing.kindOf(part) !== "closure") continue;
    const name = p.pattern.name;
    let uses = 0;
    let calls = 0;
    // A generic function value runs another instance for each type it is called with.
    let runs = new Set<InstanceId>();
    // Inside a nested arrow or function only reading it counts: its calls aren't the body's.
    for (const st of b.body) {
      walkWhile({ of: "stmt", node: st }, (n) => {
        if (n.of === "objectProp" && n.node.kind === "shorthand" && n.node.name === name) uses++;
        if (n.of !== "expr") return true;
        const e = n.node;
        if (e.kind === "ident" && e.name === name) uses++;
        if (e.kind === "arrow" || e.kind === "function") {
          walk(n, (m) => {
            if (m.of === "expr" && m.node.kind === "ident" && m.node.name === name) uses++;
            if (m.of === "objectProp" && m.node.kind === "shorthand" && m.node.name === name) uses++;
          });
          return false;
        }
        if (e.kind === "call") {
          const target = arenas.instanceOf(i).calls.get(e);
          if (e.callee.kind === "ident" && e.callee.name === name && e.args.every((a) => a.kind !== "spread")) {
            calls++;
            if (target !== undefined) runs.add(target);
          }
          let j: usize = 0;
          for (const a of e.args) {
            if (a.kind === "ident" && a.name === name && j === (k as usize) && target !== undefined && sameFunction(arenas, target, i)) calls++;
            j++;
          }
        }
        return true;
      });
    }
    // A call through the pair passes an environment and builds no frame, so it can only run a
    // plain closure: a generic function value's instance takes no environment.
    const plain = [...runs].every((r) => {
      const called = bodyOf(arenas, arenas.instanceOf(r));
      return called.closure !== undefined && called.async !== true && called.generator !== true;
    });
    if (uses > 0 && uses === calls && runs.size <= 1 && plain) at.add(k as usize);
  }
  return at;
}


export function sameFunction(arenas: Ref<Arenas>, a: InstanceId, b: InstanceId): boolean {
  const x = bodyOf(arenas, arenas.instanceOf(a));
  const y = bodyOf(arenas, arenas.instanceOf(b));
  return x.name === y.name && x.start === y.start;
}


// The closure's body a call of the parameter `name` runs, in `i`.
export function calledThrough(arenas: Ref<Arenas>, i: InstanceId, name: string): InstanceId | undefined {
  let found: InstanceId | undefined = undefined;
  const body2 = bodyOf(arenas, arenas.instanceOf(i)).body;
  for (const st of body2) {
    walkWhile({ of: "stmt", node: st }, (n) => {
      if (found !== undefined) return false;
      if (n.of === "expr" && n.node.kind === "call" && n.node.callee.kind === "ident" && n.node.callee.name === name) {
        const target = arenas.instanceOf(i).calls.get(n.node);
        if (target !== undefined) found = target;
      }
      return true;
    });
  }
  return found;
}
