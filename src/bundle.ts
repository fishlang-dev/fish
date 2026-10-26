import { join, resolve } from "node:path";
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

// The package a file of the bundle belongs to, as node_modules names it.
const packageOf = (file: string) => /.*node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(file)?.[1];

async function main(request: Request): Promise<Result> {
  const files: Record<string, string> = {};
  const virtual = (r: Request[number]) => join(r.dir, `__fish_package_${r.index}__.js`);
  const entry = join(request[0]!.dir, "__fish_packages__.js");
  for (const r of request) files[virtual(r)] = `export * as ns from ${JSON.stringify(r.specifier)};\n`;
  files[entry] = `${request.map((r) => `export { ns as p${r.index} } from ${JSON.stringify(virtual(r))};`).join("\n")}\n`;
  // Bun's own helpers make `require` from node:module; a package's require of anything that
  // isn't bundled fails when it runs, as a require of a missing module does.
  const requires = join(request[0]!.dir, "__fish_require__.js");
  files[requires] = "export function createRequire() { return (name) => { throw new Error(`Cannot find module '${name}'`); }; }\n";
  // The import a file of the bundle is reached through: a package's own name names it, and any
  // other file is the first package's, as nothing better is known.
  const owner = (file: string) => {
    const name = packageOf(file);
    return request.find((r) => file === virtual(r) || (name !== undefined && (r.specifier === name || r.specifier.startsWith(`${name}/`)))) ?? request[0]!;
  };
  const unbuilt = (log: BuildLog | undefined, otherwise: string): Result => {
    const r = owner(log?.position?.file ?? "");
    const said = (log?.message ?? otherwise).replace(/\s*Maybe you need to "bun install"\?$/, "");
    return { index: r.index, message: `'${r.specifier}' has no JS Fish could bundle: ${said}` };
  };
  let built: Awaited<ReturnType<typeof Bun.build>>;
  try {
    built = await Bun.build({
      entrypoints: [entry],
      files,
      target: "node",
      format: "esm",
      metafile: true,
      // Bun's bundler takes a plugin's filter as a regex, and one matching every path hides the
      // bundle's in-memory files.
      plugins: [{
        name: "fish require",
        setup(build) {
          // Bun's own helpers are imported by a module with no path.
          build.onResolve({ filter: /^(node:)?module$/ }, (args) => (args.importer.startsWith("/") ? undefined : { path: requires }));
        },
      }],
    });
  } catch (e) {
    return unbuilt((e as { errors?: BuildLog[] }).errors?.[0], String(e));
  }
  if (!built.success) return unbuilt(built.logs.find((l) => l.level === "error") as BuildLog | undefined, "the bundler couldn't build it");
  // What the bundler left outside the bundle, building for Node, is Node's own modules.
  const inputs = built.metafile?.inputs ?? {};
  const builtIns = Object.entries(inputs).flatMap(([file, input]) => (input as { imports: { path: string; external?: boolean }[] }).imports
    .filter((i) => i.external).map((i) => ({ importer: resolve(file), name: i.path.replace(/^node:/, "") })));
  if (builtIns.length > 0) return builtInUsed(request, builtIns[0]!, inputs, virtual);
  return { code: await built.outputs[0]!.text() };
}

// A Node built-in the bundle would need, said of the program's import that reaches it, through
// the package that uses it when that is another.
function builtInUsed(request: Request, used: { importer: string; name: string }, inputs: Record<string, { imports: { path: string; external?: boolean }[] }>, virtual: (r: Request[number]) => string): Result {
  const graph = new Map(Object.entries(inputs).map(([file, input]) => [resolve(file), input.imports.filter((i) => !i.external).map((i) => resolve(i.path))]));
  const reaches = (from: string, seen = new Set<string>()): boolean => {
    if (from === used.importer) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return (graph.get(from) ?? []).some((next) => reaches(next, seen));
  };
  const r = request.find((q) => reaches(virtual(q))) ?? request[0]!;
  const user = packageOf(used.importer);
  const through = user === undefined || r.specifier === user || r.specifier.startsWith(`${user}/`) ? "" : ` through '${user}'`;
  return { index: r.index, message: `'${r.specifier}' needs Node's '${used.name}' module${through}, which a package's JS can't use in Fish yet` };
}

if (import.meta.main) console.log(JSON.stringify(await main(JSON.parse(await Bun.stdin.text()) as Request)));
