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
// case: util_parse_args_not_literal
// error: 'parseArgs' takes its config as an object literal written in the call, so its result's type is known while compiling
import { parseArgs } from "node:util";
function main(): void throws ParseArgsError {
  const config = { args: ["a"] };
  parseArgs(config);
}
// case: util_parse_args_options_variable
// error: 'parseArgs' takes 'options' as an object literal written in the call
import { parseArgs } from "node:util";
function main(): void throws ParseArgsError {
  const options = { a: { type: "boolean" } };
  parseArgs({ options });
}
// case: util_parse_args_not_strict
// error: 'strict: false' in parseArgs isn't supported yet; its values would have no type
import { parseArgs } from "node:util";
function main(): void throws ParseArgsError {
  parseArgs({ strict: false });
}
// case: util_parse_args_tokens
// error: 'tokens: true' in parseArgs isn't supported yet
import { parseArgs } from "node:util";
function main(): void throws ParseArgsError {
  parseArgs({ tokens: true });
}
// case: util_parse_args_unknown_setting
// error: 'option' isn't a parseArgs setting; they are args, options, strict, allowPositionals, allowNegative, tokens
import { parseArgs } from "node:util";
function main(): void throws ParseArgsError {
  parseArgs({ option: {} });
}
// case: util_parse_args_bad_type
// error: the option 'n' needs 'type: "string"' or 'type: "boolean"'
import { parseArgs } from "node:util";
function main(): void throws ParseArgsError {
  parseArgs({ options: { n: { type: "number" } } });
}
// case: util_parse_args_long_short
// error: the option 'v' takes 'short' as one character written in the call, like short: "v"
import { parseArgs } from "node:util";
function main(): void throws ParseArgsError {
  parseArgs({ options: { v: { type: "boolean", short: "vv" } } });
}
// case: util_parse_args_bad_default
// error: the option 'n' gives a string, so its default is a string too
import { parseArgs } from "node:util";
function main(): void throws ParseArgsError {
  parseArgs({ options: { n: { type: "string", default: true } } });
}
// case: util_parse_args_not_positional
// error: allowPositionals
import { parseArgs } from "node:util";
function main(): void throws ParseArgsError {
  const on = true;
  parseArgs({ allowPositionals: on });
}
// case: util_parse_args_uncaught
// error: ParseArgsError
import { parseArgs } from "node:util";
function main() {
  parseArgs({ args: [] });
}
// case: util_parse_args_generic_and_async
// expect: 3 a
// expect: 1 b
// expect: true
import { parseArgs } from "node:util";
function count<T>(x: T, args: string[]): i64 throws ParseArgsError {
  const { values, positionals } = parseArgs({ args, options: { k: { type: "string" } }, allowPositionals: true });
  console.log(positionals.length, values.k ?? "-");
  return 0;
}
async function later(): Promise<boolean> throws ParseArgsError {
  await yieldNow();
  const { values } = parseArgs({ args: ["--q"], options: { q: { type: "boolean" } } });
  return values.q ?? false;
}
async function main(): Promise<void> throws ParseArgsError {
  count(1, ["x", "y", "z", "--k", "a"]);
  count("s", ["x", "--k=b"]);
  const q = await later();
  console.log(q);
}
// case: util_parse_args_bad_default_list
// error: the option 'n' gives a string array, so its default is a string[] too
import { parseArgs } from "node:util";
function main(): void throws ParseArgsError {
  parseArgs({ options: { n: { type: "string", multiple: true, default: "a" } } });
}
