// case: util_print_formats
// expect: 3 items, first 1
// expect: 100%% kept alone
import { format } from "node:util";
function main() {
  const xs = [1, 2, 3];
  print("%d items, first %s", xs.length, xs[0]);
  print("100%% kept alone");
}
// case: util_format_json_refused
// error: '%j' in a format isn't supported yet; pass 'JSON.stringify(x)' to '%s' instead
import { format } from "node:util";
function main() {
  console.log(format("%j", { a: 1 }));
}
// case: util_format_function_refused
// error: printing a function isn't supported yet
import { format } from "node:util";
function main() {
  const f = (x: i64): i64 => x;
  console.log(format("%s", f));
}
// case: util_format_not_a_value
// error: rest parameter
import { format } from "node:util";
function main() {
  const f = format;
}
// case: util_unknown_member
// error: 'node:util' has no export named 'promisify'
import { promisify } from "node:util";
function main() {}
// case: util_format_shadowed
// expect: mine 2
function format(a: string, b: i64): string {
  return `mine ${b}`;
}
function main() {
  console.log(format("%d", 2));
}
// case: util_inspect_options
// error: 'inspect' takes the value alone; its options aren't supported yet
import { inspect } from "node:util";
function main() {
  console.log(inspect([1], { depth: 0 }));
}
// case: util_equal_unrelated
// error: have no overlap
import { isDeepStrictEqual } from "node:util";
function main() {
  const a: i64 = 1;
  console.log(isDeepStrictEqual(a, "1"));
}
// case: util_equal_moves_nothing
// expect: true 2
import { isDeepStrictEqual } from "node:util";
function main() {
  const xs = [1, 2];
  const same = isDeepStrictEqual(xs, [1, 2]);
  console.log(same, xs.length);
}
