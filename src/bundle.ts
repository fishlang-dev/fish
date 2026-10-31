import { join, resolve } from "node:path";
import { CompileError } from "./diag.ts";
import type { Package } from "./modules.ts";

// The JS a program's packages run as: one ESM module made by Bun's bundler, exporting the
// namespace of the program's n-th package specifier as `p<n>`. Each specifier is imported from a
// file that exists only in memory, in the directory its import resolves from, so node_modules is
// searched from there as Node would.

type Request = { specifier: string; dir: string; index: number }[];
// The bundled JS, or a refusal with its code: a missing package, or one needing a module Fish's
// JS lacks.
type Result = { js: string } | { index: number; message: string; code: string };
type BuildLog = { message: string; position?: { file?: string } | null };

// Bundles the packages at `used`, the indexes of those the program's code reaches. Bun's
// bundler runs only asynchronously, so it runs in a process of its own.
export function bundle(packages: Package[], used: number[]): string {
  const request: Request = used.map((index) => ({ specifier: packages[index]!.specifier, dir: packages[index]!.dir, index }));
  const run = Bun.spawnSync([process.execPath, import.meta.path], { stdin: new TextEncoder().encode(JSON.stringify(request)) });
  if (run.exitCode !== 0) throw new Error(`bundling the program's packages failed:\n${run.stderr.toString()}`);
  const result = JSON.parse(run.stdout.toString()) as Result;
  if ("js" in result) return result.js;
  const at = packages[result.index]!.at;
  throw new CompileError(result.code, result.message, at.start, at.end);
}

// The Node modules Fish's std has, as bundled JS sees them: `path` as Node's POSIX path written
// out, the rest calling Fish's runtime through the host functions on `__fish`. A member Fish's
// std doesn't have is left out, undefined where JS reads it.
const PATH = String.raw`
const sep = "/";
const delimiter = ":";
function normalizeString(path, allowAboveRoot) {
  let res = "";
  let lastSegmentLength = 0;
  let lastSlash = -1;
  let dots = 0;
  let code = 0;
  for (let i = 0; i <= path.length; ++i) {
    if (i < path.length) code = path.charCodeAt(i);
    else if (code === 47) break;
    else code = 47;
    if (code === 47) {
      if (lastSlash === i - 1 || dots === 1) {
      } else if (dots === 2) {
        if (res.length < 2 || lastSegmentLength !== 2 || res.charCodeAt(res.length - 1) !== 46 || res.charCodeAt(res.length - 2) !== 46) {
          if (res.length > 2) {
            const lastSlashIndex = res.lastIndexOf("/");
            if (lastSlashIndex === -1) {
              res = "";
              lastSegmentLength = 0;
            } else {
              res = res.slice(0, lastSlashIndex);
              lastSegmentLength = res.length - 1 - res.lastIndexOf("/");
            }
            lastSlash = i;
            dots = 0;
            continue;
          } else if (res.length !== 0) {
            res = "";
            lastSegmentLength = 0;
            lastSlash = i;
            dots = 0;
            continue;
          }
        }
        if (allowAboveRoot) {
          res += res.length > 0 ? "/.." : "..";
          lastSegmentLength = 2;
        }
      } else {
        if (res.length > 0) res += "/" + path.slice(lastSlash + 1, i);
        else res = path.slice(lastSlash + 1, i);
        lastSegmentLength = i - lastSlash - 1;
      }
      lastSlash = i;
      dots = 0;
    } else if (code === 46 && dots !== -1) {
      ++dots;
    } else {
      dots = -1;
    }
  }
  return res;
}
function resolve(...args) {
  let resolved = "";
  let absolute = false;
  for (let i = args.length - 1; i >= -1 && !absolute; i--) {
    const path = i >= 0 ? args[i] : __fish.cwd();
    if (path.length === 0) continue;
    resolved = path + "/" + resolved;
    absolute = path.charCodeAt(0) === 47;
  }
  resolved = normalizeString(resolved, !absolute);
  if (absolute) return "/" + resolved;
  return resolved.length > 0 ? resolved : ".";
}
function normalize(path) {
  if (path.length === 0) return ".";
  const absolute = path.charCodeAt(0) === 47;
  const trailing = path.charCodeAt(path.length - 1) === 47;
  path = normalizeString(path, !absolute);
  if (path.length === 0) return absolute ? "/" : trailing ? "./" : ".";
  if (trailing) path += "/";
  return absolute ? "/" + path : path;
}
function join(...args) {
  const parts = args.filter((a) => a.length > 0);
  return parts.length === 0 ? "." : normalize(parts.join("/"));
}
function relative(from, to) {
  if (from === to) return "";
  from = resolve(from);
  to = resolve(to);
  if (from === to) return "";
  const fromEnd = from.length;
  const fromLen = fromEnd - 1;
  const toLen = to.length - 1;
  const length = fromLen < toLen ? fromLen : toLen;
  let lastCommonSep = -1;
  let i = 0;
  for (; i < length; i++) {
    const code = from.charCodeAt(1 + i);
    if (code !== to.charCodeAt(1 + i)) break;
    else if (code === 47) lastCommonSep = i;
  }
  if (i === length) {
    if (toLen > length) {
      if (to.charCodeAt(1 + i) === 47) return to.slice(2 + i);
      if (i === 0) return to.slice(1 + i);
    } else if (fromLen > length) {
      if (from.charCodeAt(1 + i) === 47) lastCommonSep = i;
      else if (i === 0) lastCommonSep = 0;
    }
  }
  let out = "";
  for (i = 2 + lastCommonSep; i <= fromEnd; ++i) {
    if (i === fromEnd || from.charCodeAt(i) === 47) out += out.length === 0 ? ".." : "/..";
  }
  return out + to.slice(1 + lastCommonSep);
}
function dirname(path) {
  if (path.length === 0) return ".";
  const hasRoot = path.charCodeAt(0) === 47;
  let end = -1;
  let matchedSlash = true;
  for (let i = path.length - 1; i >= 1; --i) {
    if (path.charCodeAt(i) === 47) {
      if (!matchedSlash) {
        end = i;
        break;
      }
    } else matchedSlash = false;
  }
  if (end === -1) return hasRoot ? "/" : ".";
  if (hasRoot && end === 1) return "//";
  return path.slice(0, end);
}
function basename(path, suffix) {
  let start = 0;
  let end = -1;
  let matchedSlash = true;
  if (suffix !== undefined && suffix.length > 0 && suffix.length <= path.length) {
    if (suffix === path) return "";
    let extIdx = suffix.length - 1;
    let firstNonSlashEnd = -1;
    for (let i = path.length - 1; i >= 0; --i) {
      const code = path.charCodeAt(i);
      if (code === 47) {
        if (!matchedSlash) {
          start = i + 1;
          break;
        }
      } else {
        if (firstNonSlashEnd === -1) {
          matchedSlash = false;
          firstNonSlashEnd = i + 1;
        }
        if (extIdx >= 0) {
          if (code === suffix.charCodeAt(extIdx)) {
            if (--extIdx === -1) end = i;
          } else {
            extIdx = -1;
            end = firstNonSlashEnd;
          }
        }
      }
    }
    if (start === end) end = firstNonSlashEnd;
    else if (end === -1) end = path.length;
    return path.slice(start, end);
  }
  for (let i = path.length - 1; i >= 0; --i) {
    if (path.charCodeAt(i) === 47) {
      if (!matchedSlash) {
        start = i + 1;
        break;
      }
    } else if (end === -1) {
      matchedSlash = false;
      end = i + 1;
    }
  }
  return end === -1 ? "" : path.slice(start, end);
}
function extname(path) {
  let startDot = -1;
  let startPart = 0;
  let end = -1;
  let matchedSlash = true;
  let preDotState = 0;
  for (let i = path.length - 1; i >= 0; --i) {
    const code = path.charCodeAt(i);
    if (code === 47) {
      if (!matchedSlash) {
        startPart = i + 1;
        break;
      }
      continue;
    }
    if (end === -1) {
      matchedSlash = false;
      end = i + 1;
    }
    if (code === 46) {
      if (startDot === -1) startDot = i;
      else if (preDotState !== 1) preDotState = 1;
    } else if (startDot !== -1) preDotState = -1;
  }
  if (startDot === -1 || end === -1 || preDotState === 0 || (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)) return "";
  return path.slice(startDot, end);
}
const path = { sep, delimiter, resolve, normalize, join, relative, dirname, basename, extname };
path.posix = path;
const posix = path;
export { sep, delimiter, resolve, normalize, join, relative, dirname, basename, extname, posix };
export default path;
`;

const OS = String.raw`
export const hostname = () => __fish.hostname();
export const tmpdir = () => __fish.tmpdir();
export const homedir = () => __fish.homedir();
export const platform = () => __fish.platform();
export const availableParallelism = () => __fish.parallelism();
export const EOL = "\n";
export default { hostname, tmpdir, homedir, platform, availableParallelism, EOL };
`;

// The process global, made before any package runs, as Node makes it. Fish's environment is
// read-only, so what JS writes to process.env is kept for JS alone, as packages that default
// NODE_ENV expect to read it back.
const GLOBALS = String.raw`
const written = new Map();
const read = (name) => (written.has(name) ? written.get(name) : __fish.getenv(name));
const env = new Proxy({}, {
  get: (target, name) => (typeof name === "string" ? read(name) : undefined),
  has: (target, name) => typeof name === "string" && read(name) !== undefined,
  set: (target, name, value) => (written.set(name, String(value)), true),
  deleteProperty: (target, name) => (written.set(name, undefined), true),
});
globalThis.process ??= { argv: __fish.argv(), env, platform: __fish.platform(), exit: (code) => __fish.exit(code) };
`;

const PROCESS = String.raw`
const process = globalThis.process;
export const argv = process.argv;
export const env = process.env;
export const platform = process.platform;
export const exit = process.exit;
export default process;
`;

// Bytes read are a Uint8Array that stringifies as text, as Node's Buffer does, so
// String(await readFile(p)) and JSON.parse(await readFile(p)) read the file.
const FS_PROMISES = String.raw`
class Bytes extends Uint8Array {
  toString(encoding = "utf8") {
    if (encoding !== "utf8" && encoding !== "utf-8") throw new TypeError("Fish decodes a file's bytes only as utf8 so far, not " + encoding);
    return __fish.decode(this);
  }
}
export const readFile = (path, options) => __fish.readFile(path, options).then((read) => (typeof read === "string" ? read : new Bytes(read.buffer, read.byteOffset, read.length)));
export const writeFile = (path, data) => __fish.writeFile(path, data);
export default { readFile, writeFile };
`;

// Each shim by the names a package imports it under.
const SHIMS: Record<string, string> = { path: PATH, "path/posix": PATH, os: OS, process: PROCESS, "fs/promises": FS_PROMISES };

// The package a file of the bundle belongs to, as node_modules names it.
const packageOf = (file: string) => /.*node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(file)?.[1];

async function main(request: Request): Promise<Result> {
  const files: Record<string, string> = {};
  const virtual = (r: Request[number]) => join(r.dir, `__fish_package_${r.index}__.js`);
  const entry = join(request[0]!.dir, "__fish_packages__.js");
  for (const r of request) files[virtual(r)] = `export * as ns from ${JSON.stringify(r.specifier)};\n`;
  // The globals come first, as a module's imports run in order.
  const shim = (name: string) => join(request[0]!.dir, `__fish_shim_${name.replace("/", "_")}__.js`);
  files[shim("globals")] = GLOBALS;
  for (const [name, source] of Object.entries(SHIMS)) files[shim(name)] = source;
  files[entry] = `import ${JSON.stringify(shim("globals"))};\n${request.map((r) => `export { ns as p${r.index} } from ${JSON.stringify(virtual(r))};`).join("\n")}\n`;
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
    const bun = /cannot import Bun builtin: "([^"]+)"/.exec(said)?.[1];
    if (bun) return { index: r.index, code: "E1005", message: `'${r.specifier}' needs Bun's own '${bun}' module, which a package's JS can't use in Fish yet` };
    return { index: r.index, code: "E0901", message: `'${r.specifier}' has no JS Fish could bundle: ${said}` };
  };
  let built: Awaited<ReturnType<typeof Bun.build>>;
  try {
    built = await Bun.build({
      entrypoints: [entry],
      files,
      target: "node",
      format: "esm",
      metafile: true,
      // Bun's bundler otherwise inlines the compiler's own NODE_ENV.
      define: { "process.env.NODE_ENV": "process.env.NODE_ENV" },
      // Bun's bundler takes a plugin's filter as a regex, and one matching every path hides the
      // bundle's in-memory files.
      plugins: [{
        name: "fish require",
        setup(build) {
          // Bun's own helpers are imported by a module with no path.
          build.onResolve({ filter: /^(node:)?module$/ }, (args) => (args.importer.startsWith("/") ? undefined : { path: requires }));
          build.onResolve({ filter: /^(node:)?(path|path\/posix|os|process|fs\/promises)$/ }, (args) => ({ path: shim(args.path.replace(/^node:/, "")) }));
        },
      }],
    });
  } catch (e) {
    return unbuilt((e as { errors?: BuildLog[] }).errors?.[0], String(e));
  }
  if (!built.success) return unbuilt(built.logs.find((l) => l.level === "error") as BuildLog | undefined, "the bundler couldn't build it");
  // What the bundler left outside the bundle that Node has is one of Node's own modules; any
  // other, like an optional require of a package that isn't installed, fails when it runs.
  const inputs = built.metafile?.inputs ?? {};
  const builtIns = Object.entries(inputs).flatMap(([file, input]) => (input as { imports: { path: string; external?: boolean }[] }).imports
    .filter((i) => i.external && process.getBuiltinModule(i.path) !== undefined).map((i) => ({ importer: resolve(file), name: i.path.replace(/^node:/, "") })));
  if (builtIns.length > 0) return builtInUsed(request, builtIns[0]!, inputs, virtual);
  return { js: await built.outputs[0]!.text() };
}

// A Node built-in the bundle would need, said of the program's import that reaches it, through
// the package that uses it when that is another.
function builtInUsed(request: Request, used: { importer: string; name: string }, inputs: Record<string, { imports: { path: string; external?: boolean }[] }>, virtual: (r: Request[number]) => string): Result {
  const graph = new Map(Object.entries(inputs).map(([file, input]) => [resolve(file), input.imports.filter((i) => !i.external).map((i) => resolve(i.path))]));
  const reaches = (from: string, seen: Set<string> = new Set<string>()): boolean => {
    if (from === used.importer) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return (graph.get(from) ?? []).some((next) => reaches(next, seen));
  };
  const r = request.find((q) => reaches(virtual(q))) ?? request[0]!;
  const user = packageOf(used.importer);
  const through = user === undefined || r.specifier === user || r.specifier.startsWith(`${user}/`) ? "" : ` through '${user}'`;
  const runtime = used.name === "bun" || used.name.startsWith("bun:") ? "Bun's own" : "Node's";
  return { index: r.index, code: "E1005", message: `'${r.specifier}' needs ${runtime} '${used.name}' module${through}, which a package's JS can't use in Fish yet` };
}

if (import.meta.main) console.log(JSON.stringify(await main(JSON.parse(await Bun.stdin.text()) as Request)));
