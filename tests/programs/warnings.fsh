// Warnings: what a build reports on stderr without failing, for variables and parameters nothing
// reads and statements control never reaches.
// case: warn_unused_variable
// expect: 1
// warning: warn_unused_variable.fsh:6:9: warning: unused variable 'unused'; if it's intentional, name it '_unused'
// warning:  6 |   const unused = 2;
function main() {
  const used = 1;
  const unused = 2;
  console.log(used);
}
// case: warn_unused_let_and_loop_variable
// expect: 3
// warning: warn_unused_let_and_loop_variable.fsh:5:7: warning: unused variable 'n'
// warning: warn_unused_let_and_loop_variable.fsh:7:14: warning: unused variable 'x'
function main() {
  let n = 0;
  let count = 0;
  for (const x of [1, 2, 3]) count++;
  console.log(count);
}
// case: warn_unused_destructured
// expect: 1 3
// warning: warn_unused_destructured.fsh:6:13: warning: unused variable 'b'
// warning: warn_unused_destructured.fsh:7:14: warning: unused variable 'y'
function main() {
  const o = { x: 3, y: 4 };
  const [a, b] = [1, 2];
  const { x, y } = o;
  console.log(a, x);
}
// case: warn_unused_parameters
// expect: p
// expect: 3
// expect: true
// warning: warn_unused_parameters.fsh:10:24: warning: unused parameter 'b'; if it's intentional, name it '_b'
// warning: warn_unused_parameters.fsh:14:25: warning: unused parameter 'i'
// warning: warn_unused_parameters.fsh:21:8: warning: unused parameter 'n'
// warning: warn_unused_parameters.fsh:23:25: warning: unused parameter 'width'
// warning:  23 | function pad(s: string, width: i64 = 4): string { return s; }
// warning:     |                         ^^^^^
function first(a: i64, b: i64): i64 { return a; }
function main() {
  console.log(pad("p"));
  const xs = [1, 2];
  const ys = xs.map((x, i) => x + 1);
  console.log(first(ys[1], 0));
  console.log(new Box(1).less(2) === 0);
}
class Box {
  v: i64;
  constructor(v: i64) { this.v = v; }
  less(n: i64): i64 { return this.v - 1; }
}
function pad(s: string, width: i64 = 4): string { return s; }
// case: warn_none_where_names_are_used_or_required
// expect: 6
// expect: 10 2 5 1 4
// warning: warn_none_where_names_are_used_or_required.fsh:7:9: warning: unused variable 'sentinel'
// The one warning is the sentinel's: an underscore, a capture, a shorthand, an export, an
// interface's method and an override all keep their names from warning.
function main() {
  const sentinel = 0;
  const _quiet = 1;
  const captured = 5;
  const add = (n: i64) => n + captured;
  const v = 2;
  const o = { v };
  console.log(add(1));
  const shapes: Dyn<Shape>[] = [new Sq(1)];
  console.log(twice(5, 0), o.v, add(0), shapes[0].area(9), new Big().size(2));
}
export function twice(n: i64, unusedButExported: i64): i64 { return n * 2; }
function ignored(_n: i64): i64 { return 0; }
interface Shape { area(scale: i64): i64; }
class Sq implements Shape {
  side: i64;
  constructor(side: i64) { this.side = side; }
  area(scale: i64): i64 { return this.side; }
}
class Small { size(by: i64): i64 { return by * 2; } }
class Big extends Small { size(by: i64): i64 { return 4; } }
// case: warn_none_in_macro_code
// expect: 7
// warning: warn_none_in_macro_code.fsh:9:9: warning: unused variable 'sentinel'
// What a macro made warns nowhere; the sentinel shows warnings are on.
macro function withHelper(input: AstStmt): Ast[] {
  return [input, quote`function ${ident("helper")}(${ident("skipped")}: i64): i64 { const ${ident("spare")}: i64 = 1; return 7; }`];
}
@withHelper function base(): i64 { return 0; }
function main() {
  const sentinel = 0;
  console.log(helper(base()));
}
// case: warn_unreachable
// expect: 1
// warning: warn_unreachable.fsh:11:5: warning: unreachable code after 'return'
// warning:  11 |     console.log("never");
// warning: warn_unreachable.fsh:16:5: warning: unreachable code after 'continue'
// warning: warn_unreachable.fsh:20:5: warning: unreachable code after 'break'
// warning: warn_unreachable.fsh:26:3: warning: unreachable code after 'throw'
// warning: warn_unreachable.fsh:30:3: warning: unreachable code after a call that never returns
function f(n: i64): i64 {
  if (n > 0) {
    return 1;
    console.log("never");
    console.log("reported once");
  }
  for (let i = 0; i < 2; i++) {
    continue;
    console.log("skipped");
  }
  while (true) {
    break;
    console.log("left");
  }
  return 0;
}
function fail(): void throws string {
  throw "no";
  console.log("thrown");
}
function stop(): void {
  process.exit(0);
  console.log("exited");
}
function main() {
  console.log(f(1));
}
// case: warn_unreachable_hoisted_declarations_ignored
// expect: 2
// warning: warn_unreachable_hoisted_declarations_ignored.fsh:8:3: warning: unreachable code after 'return'
// A declaration after a 'return' is hoisted, so it isn't unreachable; the code after it is.
function main() {
  console.log(g());
  return;
  function g(): i64 { return 2; }
  console.log("unreached");
}
