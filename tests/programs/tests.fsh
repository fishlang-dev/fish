// Top-level test blocks, which a build leaves out, and assert.
// case: tests_left_out
// expect: 3
function add(a: i64, b: i64): i64 {
  return a + b;
}
test("adds", () => {
  const n: i64 = true;
  assert(add(1, 2) === 4);
});
test("adds later", async () => {
  missing();
});
test("with a function", function () {
  throw new Error("never built");
});
function main() {
  console.log(add(1, 2));
}
// case: tests_left_out_of_release
// mode: release
// expect: ran
test("x", () => {
  const n: i64 = "no";
});
function main() {
  console.log("ran");
}
// case: test_without_a_name
// error: test_without_a_name.fsh:2:1: error[E1106]: a test is written as 'test("name", () => { ... })' at the top level of a file, its name a string literal
test(1);
function main() {}
// case: test_without_a_body
// error: test_without_a_body.fsh:5:1: error[E1106]: a test is written as 'test("name", () => { ... })'
// error:  5 | test("a", 2);
// error:    | ^^^^^^^^^^^^
function main() {}
test("a", 2);
// case: test_name_with_a_line_break
// error: test_name_with_a_line_break.fsh:2:6: error[E1106]: a test's name is one line, so it can't hold a line break
test("two\nlines", () => {});
function main() {}
// case: test_taking_parameters
// error: a test is written as
test("a", (n: i64) => {});
function main() {}
// case: test_as_a_local_name
// expect: 4
function main() {
  const test = (n: i64): i64 => n * 2;
  console.log(test(2));
}
// case: assert_passing
// expect: done
function main() {
  assert(true);
  assert(1 < 2, "one is less than two");
  console.log("done");
}
// case: assert_message_only_on_failure
// expect: made
// panic: from a call
function message(): string {
  console.log("made");
  return "from a call";
}
function main() {
  assert(true, message());
  assert(1 < 2, message());
  assert(1 > 2, message());
}
// case: assert_message
// panic: assert_message.fsh:5:3:
// panic: boom
function main() {
  const message = "bo" + "om";
  assert(1 > 2, message);
}
// case: assert_without_message
// panic: assert_without_message.fsh:4:3:
// panic: assertion failed: false
function main() {
  assert(false);
}
// case: assert_condition_as_written
// panic: assertion failed: xs.length === 3 || "%s".length === 0
function main() {
  const xs = [1, 2];
  assert(xs.length === 3 || "%s".length === 0);
}
// case: assert_in_release
// mode: release
// panic: assert_in_release.fsh:6:3:
// panic: n is small
function main() {
  const n = 3;
  assert(n < 2, "n is small");
}
// case: assert_condition
// error: condition must be a boolean, not 'i64'
function main() {
  assert(1);
}
// case: assert_message_type
// error: an assertion's message is a string, not 'i64'
function main() {
  assert(true, 3);
}
// case: assert_arguments
// error: 'assert' takes a condition and an optional message
function main() {
  assert();
}
// case: assert_narrows
// expect: 4
// expect: 3
type Shape = { kind: "circle"; r: i64 } | { kind: "square"; side: i64 };
function side(s: Shape): i64 {
  assert(s.kind === "square", "a square");
  return s.side;
}
function main() {
  const x: i64 | null = 3;
  assert(x !== null);
  console.log(x + 1);
  console.log(side({ kind: "square", side: 3 }));
}
// case: assert_narrows_only_after_it
// error: operator '+' can't use the Option 'i64 | null' until it is checked
function main() {
  const x: i64 | null = 3;
  console.log(x + 1);
  assert(x !== null);
}
// case: assert_node_default
// panic: assert_node_default.fsh:7:3:
// panic: from the default export
import assert from "node:assert";
function main() {
  assert(1 < 2);
  assert.ok(true, "fine");
  assert(1 > 2, "from the default export");
}
// case: assert_node_namespace
// panic: assert_node_namespace.fsh:5:3:
// panic: assertion failed: 1 > 2
import * as check from "assert";
function main() {
  check.ok(1 > 2);
}
// case: assert_node_ok
// expect: 3
// panic: assert_node_ok.fsh:9:3:
// panic: big
import { ok, ok as sure } from "node:assert";
function main() {
  const x: i64 | null = 2;
  ok(x !== null);
  console.log(x + 1);
  sure(x > 5, "big");
}
// case: assert_node_other_names
// error: 'node:assert' has no export named 'equal'
import { equal } from "node:assert";
function main() {
  equal(1, 1);
}
// case: assert_node_other_members
// error: 'node:assert' has no export named 'strictEqual'; it has 'ok'
import assert from "node:assert";
function main() {
  assert.strictEqual(1, 1);
}
