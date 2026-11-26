// case: parse_args_typed_defaults
// expect: false null [] [] 0
// The program is run with no arguments: a missing flag is false, an Option null, an array empty.
import { parseArgs } from "node:util";
type Options = {
  /** Say more. */
  verbose: boolean;
  port?: u16;
  tags: string[];
  positionals: string[];
  levels: i64[];
};
function main() {
  const o = parseArgs<Options>();
  console.log(o.verbose, o.port ?? null, o.tags, o.positionals, o.levels.length);
}
// case: parse_args_typed_bad_field
// error: 'parseArgs<T>()' reads fields that are booleans, strings or numbers, their Options, and arrays of them
import { parseArgs } from "node:util";
function main() {
  const o = parseArgs<{ when: Map<string, i64> }>();
}
// case: parse_args_typed_bad_name
// error: 'parseArgs<T>()' reads fields named in camelCase, which it gives as --kebab-case options; 'dry_run' isn't
import { parseArgs } from "node:util";
function main() {
  const o = parseArgs<{ dry_run: boolean }>();
}
// case: parse_args_typed_bad_positionals
// error: 'parseArgs<T>()' reads 'positionals' as a 'string[]', the arguments that aren't options
import { parseArgs } from "node:util";
function main() {
  const o = parseArgs<{ positionals: i64[] }>();
}
// case: parse_args_typed_arguments
// error: 'parseArgs<T>()' takes no arguments; it reads the program's own
import { parseArgs } from "node:util";
function main() {
  const o = parseArgs<{ a: boolean }>({ args: [] });
}
// case: parse_args_typed_not_object
// error: 'parseArgs<T>()' reads an object type, an alias of one or an interface, written as its type argument
import { parseArgs } from "node:util";
function main() {
  const o = parseArgs<string>();
}
