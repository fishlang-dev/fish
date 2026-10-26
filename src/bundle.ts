import { builtinModules } from "node:module";
import { join } from "node:path";
import { CompileError } from "./diag.ts";
import type { Package } from "./modules.ts";

// The JS a program's packages run as: one ESM module made by Bun's bundler, exporting the
// namespace of the program's n-th package specifier as `p<n>`. Each specifier is imported from a
// file that exists only in memory, in the directory its import resolves from, so node_modules is
// searched from there as Node would.

type Request = { specifier: string; dir: string; index: number }[];
type Result = { code: string } | { index: number; message: string };
type BuildLog = { message: string; position?: { file?: string } | null };

// Bundles the packages at `used`, the indexes of those the program's code reaches. Bun's
// bundler runs only asynchronously, so it runs in a process of its own.
export function bundle(packages: Package[], used: number[]): string {
  const request: Request = used.map((index) => ({ specifier: packages[index]!.specifier, dir: packages[index]!.dir, index }));
  const run = Bun.spawnSync([process.execPath, import.meta.path], { stdin: new TextEncoder().encode(JSON.stringify(request)) });
  if (run.exitCode !== 0) throw new Error(`bundling the program's packages failed:\n${run.stderr.toString()}`);
  const result = JSON.parse(run.stdout.toString()) as Result;
  if ("code" in result) return result.code;
  const at = packages[result.index]!.at;
  throw new CompileError(result.message, at.start, at.end);
}

// Node's built-in modules, as a package may name them; Bun's bundler takes a plugin's filter as a
// regex, and one matching every path hides the bundle's in-memory files.
const BUILT_IN = new RegExp(`^(node:)?(${builtinModules.map((m) => m.replace(/[/.]/g, "\\$&")).join("|")})$`);

// The package a file of the bundle belongs to, as node_modules names it.
const packageOf = (file: string) => /.*node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(file)?.[1] ?? file;

async function main(request: Request): Promise<Result> {
  const files: Record<string, string> = {};
  const entry = join(request[0]!.dir, "__fish_packages__.js");
  const lines = request.map(({ specifier, dir, index }) => {
    const file = join(dir, `__fish_package_${index}__.js`);
    files[file] = `export * as ns from ${JSON.stringify(specifier)};\n`;
    return `export { ns as p${index} } from ${JSON.stringify(file)};`;
  });
  files[entry] = `${lines.join("\n")}\n`;
  // Bun's own helpers make `require` from node:module; a package's require of anything that
  // isn't bundled fails when it runs, as a require of a missing module does.
  const requires = join(request[0]!.dir, "__fish_require__.js");
  files[requires] = "export function createRequire() { return (name) => { throw new Error(`Cannot find module '${name}'`); }; }\n";
  let builtIn: { index: number; message: string } | undefined;
  // A failure to build, said of the package whose import it is in.
  const unbuilt = (log: BuildLog | undefined, otherwise: string): Result => {
    const file = log?.position?.file ?? "";
    const index = request.find((r) => file === join(r.dir, `__fish_package_${r.index}__.js`))?.index ?? request[0]!.index;
    const specifier = request.find((r) => r.index === index)!.specifier;
    return { index, message: `'${specifier}' has no JS Fish could bundle: ${log?.message ?? otherwise}` };
  };
  let built: Awaited<ReturnType<typeof Bun.build>>;
  try {
    built = await Bun.build({
      entrypoints: [entry],
      files,
      target: "node",
      format: "esm",
      plugins: [{
        name: "fish built-ins",
        setup(build) {
          build.onResolve({ filter: BUILT_IN }, (args) => {
            if (!args.importer.includes("node_modules") && /^(node:)?module$/.test(args.path)) return { path: requires };
            const name = args.path.replace(/^node:/, "");
            const user = packageOf(args.importer);
            const index = request.find((r) => r.specifier === user || r.specifier.startsWith(`${user}/`))?.index ?? request[0]!.index;
            builtIn ??= { index, message: `'${user}' needs Node's '${name}' module, which a package's JS can't use in Fish yet` };
            return { path: args.path, external: true };
          });
        },
      }],
    });
  } catch (e) {
    return unbuilt((e as { errors?: BuildLog[] }).errors?.[0], String(e));
  }
  if (builtIn) return builtIn;
  if (!built.success) return unbuilt(built.logs.find((l) => l.level === "error") as BuildLog | undefined, "the bundler couldn't build it");
  return { code: await built.outputs[0]!.text() };
}

if (import.meta.main) console.log(JSON.stringify(await main(JSON.parse(await Bun.stdin.text()) as Request)));
