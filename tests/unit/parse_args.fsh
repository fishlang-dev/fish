// `parseArgs<T>()`: a program built with the native fishc and run with arguments, its output and
// exit code read back, since the golden programs run with none.
import { spawnSync } from "node:child_process";
import { built, removed, same, scratch, text } from "./support.fsh";

const TOOL = `import { parseArgs } from "node:util";
type Options = {
  /** Say more about each step. */
  verbose: boolean;
  /** The port to listen on. */
  port?: u16;
  name: string;
  /**
   * A tag to add; give it more than once for several.
   */
  tag: string[];
  ratio: f64;
  dryRun: Option<boolean>;
  positionals: string[];
};
function main() {
  const o = parseArgs<Options>();
  console.log(o.verbose, o.port ?? null, o.name, o.tag, o.ratio, o.dryRun ?? null, o.positionals);
}
`;

function run(program: string, args: string[]): string {
  const r = spawnSync(program, args);
  return `${r.status ?? -1}\n${text(r.stdout)}${text(r.stderr)}`;
}

test("parseArgs<T>() reads the command line into T, with --help and exit 2 on a bad argument", () => {
  const root = scratch("fish-args-");
  const tool = built(root, "tool", TOOL);
  same(run(tool, ["--name", "x", "--ratio", "0.5", "--verbose", "--port=8080", "--tag", "a", "--tag", "b", "--dry-run", "one", "--", "--two"]), "0\ntrue 8080 x [ 'a', 'b' ] 0.5 true [ 'one', '--two' ]\n", "every kind of field");
  same(run(tool, ["--name", "x", "--ratio", "2"]), "0\nfalse null x [] 2 null []\n", "only the required fields");
  const usage = `Usage: tool [options] [<args>...]

Options:
  --verbose        Say more about each step.
  --port <u16>     The port to listen on.
  --name <text>
  --tag <text>...  A tag to add; give it more than once for several.
  --ratio <f64>
  --dry-run
  -h, --help       Show this help
`;
  same(run(tool, ["--help"]), `0\n${usage}`, "--help");
  same(run(tool, ["--ratio", "1"]), `2\nerror: missing --name\n\n${usage}`, "a missing field");
  same(run(tool, ["--name", "x", "--ratio", "1", "--port", "70000"]), `2\nerror: --port takes an integer from 0 to 65535, not '70000'\n\n${usage}`, "a number out of range");
  same(run(tool, ["--name", "x", "--ratio", "half"]), `2\nerror: --ratio takes a number, not 'half'\n\n${usage}`, "a bad float");
  same(run(tool, ["--name", "x", "--ratio", "1", "--colour"]), `2\nerror: Unknown option '--colour'. To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- "--colour"\n\n${usage}`, "an unknown option");
  removed(root);
}, { timeout: 120_000 });
