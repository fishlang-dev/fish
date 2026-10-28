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
// error: test_without_a_name.fsh:2:1: error: a test is written as 'test("name", () => { ... })' at the top level of a file, its name a string literal
test(1);
function main() {}
// case: test_without_a_body
// error: test_without_a_body.fsh:5:1: error: a test is written as 'test("name", () => { ... })'
// error:  5 | test("a", 2);
// error:    | ^^^^^^^^^^^^
function main() {}
test("a", 2);
// case: test_name_with_a_line_break
// error: test_name_with_a_line_break.fsh:2:6: error: a test's name is one line, so it can't hold a line break
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
// case: assert_message_made_eagerly
// expect: made
// expect: made
function message(): string {
  console.log("made");
  return "unused";
}
function main() {
  assert(true, message());
  assert(1 < 2, message());
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
// panic: assertion failed
function main() {
  assert(false);
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
