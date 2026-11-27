import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// The dependencies a project's package.json names, sorted by what a port to Fish does with them:
// replace them with Fish's std, wait for a planned feature that replaces them, give up on native
// addons, or bring pure JavaScript and TypeScript across. Only the installed copies are read.

export type Group = "std" | "planned" | "native" | "pure" | "unknown";
export type Dependency = {
  name: string; version: string; dev: boolean; group: Group; kind: "native" | "pure" | "unknown";
  equivalent?: { name: string; planned: boolean };
};
export type Dependencies = { counts: Record<Group, usize>; list: Dependency[]; problem?: string };

// What replaces a package: Fish's std, or a planned feature named by its title.
type Equivalent = { name: string; planned: boolean };
const IN_STD = (name: string): Equivalent => ({ name, planned: false });
const PLANNED = (title: string): Equivalent => ({ name: title, planned: true });
const EQUIVALENTS = equivalents();

function equivalents(): Map<string, Equivalent> {
  let m = new Map<string, Equivalent>();
  add(m, ["express", "hono", "fastify", "koa", "polka", "restify", "@hono/node-server"], IN_STD("serve and Router"));
  // async-mutex holds its lock across `await`, which a Semaphore's permit can and a Lock can't.
  m.set("async-mutex", IN_STD("Semaphore"));
  m.set("p-limit", IN_STD("Semaphore"));
  // Both run a list of tasks and reject with the first to fail; a `concurrency` option still
  // wants a Semaphore beside the group.
  add(m, ["p-all", "p-map"], IN_STD("taskGroup, where no concurrency limit is asked for"));
  m.set("abort-controller", IN_STD("AbortController"));
  add(m, ["url-parse", "whatwg-url", "query-string", "querystringify"], IN_STD("URL and URLSearchParams"));
  add(m, ["node-fetch", "axios", "undici", "got", "cross-fetch", "superagent", "ky"], IN_STD("fetch"));
  add(m, ["commander", "yargs", "minimist", "meow", "cac"], PLANNED("Typed CLI arguments"));
  add(m, ["dotenv", "env-var"], PLANNED("Typed configuration from the environment"));
  // ws is mostly a server's; a program using its client waits on the WebSocket client.
  add(m, ["ws", "express-ws", "@hono/node-ws"], IN_STD("Router.ws, for a server"));
  m.set("uuid", IN_STD("crypto.randomUUID, for v4 only"));
  m.set("nanoid", IN_STD("crypto.getRandomValues, to build IDs from"));
  add(m, ["dayjs", "date-fns", "moment", "luxon"], PLANNED("Date parsing and formatting"));
  add(m, ["pino", "winston", "bunyan"], PLANNED("Structured logging"));
  add(m, ["@opentelemetry/api", "@opentelemetry/sdk-node", "@opentelemetry/sdk-trace-node", "@opentelemetry/sdk-trace-base", "@opentelemetry/exporter-trace-otlp-http"], IN_STD("the std:trace module"));
  add(m, ["pg", "postgres"], IN_STD("the postgres module's Pool"));
  add(m, ["better-sqlite3", "sqlite3"], IN_STD("std:sqlite's Database"));
  m.set("kysely", IN_STD("std:query's Kysely, compiling to SQL for std:postgres and std:sqlite"));
  add(m, ["tar", "tar-stream", "tar-fs"], IN_STD("the std:tar module"));
  add(m, ["adm-zip", "jszip", "yauzl", "yazl", "unzipper", "extract-zip"], IN_STD("the std:zip module"));
  m.set("archiver", IN_STD("the std:zip and std:tar modules"));
  add(m, ["ioredis", "redis"], IN_STD("std:redis's createClient"));
  add(m, ["glob", "fast-glob", "globby"], PLANNED("Glob"));
  m.set("fs-extra", PLANNED("Directory operations"));
  m.set("chokidar", PLANNED("File watching"));
  m.set("tmp", PLANNED("Temporary files and directories"));
  add(m, ["execa", "cross-spawn"], PLANNED("Streaming child processes"));
  add(m, ["node-cron", "cron"], PLANNED("Scheduled jobs"));
  m.set("cors", PLANNED("CORS middleware"));
  m.set("compression", PLANNED("Response compression"));
  m.set("express-rate-limit", PLANNED("Rate-limiting middleware"));
  add(m, ["cookie", "cookie-parser"], IN_STD("req.cookies and res.cookies"));
  add(m, ["serve-static", "@fastify/static", "koa-static", "sirv"], IN_STD("Router.static"));
  add(m, ["swagger-jsdoc", "@fastify/swagger", "@hono/zod-openapi", "hono-openapi", "@asteasolutions/zod-to-openapi", "tsoa"], IN_STD("fishc openapi, from Router handlers that say their types"));
  add(m, ["marked", "markdown-it"], PLANNED("Markdown to HTML"));
  add(m, ["sanitize-html", "dompurify"], PLANNED("HTML sanitization"));
  add(m, ["csv-parse", "papaparse"], PLANNED("CSV reading and writing"));
  m.set("nodemailer", PLANNED("SMTP email client"));
  m.set("eventemitter3", PLANNED("EventTarget and EventEmitter"));
  add(m, ["inquirer", "prompts"], PLANNED("Interactive prompts"));
  add(m, ["jest", "vitest", "mocha"], PLANNED("Jest-style test API"));
  m.set("@grpc/grpc-js", IN_STD("std:grpc, with messages and services as @message classes and @service interfaces"));
  m.set("@aws-sdk/client-s3", PLANNED("S3-compatible storage client"));
  add(m, ["argon2", "jsonwebtoken", "jose"], IN_STD("std:auth's signJwt, verifyJwt, hashPassword and verifyPassword (and their Sync forms)"));
  add(m, ["bcryptjs", "bcrypt"], IN_STD("std:auth's hashPassword, which hashes with argon2id rather than bcrypt"));
  return m;
}

function add(m: Mut<Map<string, Equivalent>>, names: Ref<string[]>, e: Ref<Equivalent>) {
  for (const p of names) m.set(p, { name: e.name, planned: e.planned });
}

// Packages a native addon builds or loads its compiled code through.
const NATIVE_HELPERS = new Set(["node-gyp-build", "bindings", "node-addon-api", "prebuild", "prebuild-install", "nan", "node-pre-gyp", "@mapbox/node-pre-gyp"]);
// A prebuilt binary's package names its platform and then its processor, as in
// `@esbuild/darwin-arm64`, `sharp-linux-x64` or `turbo-darwin-64`.
const PLATFORMS = /(^|[-/@])(darwin|linux|win32|freebsd|android)-(x64|arm64|ia32|arm|64|universal|x86|ppc64|s390x|riscv64|loong64|mips64el)([-.]|$)/;

// A dependency list's versions as written: one that isn't a string, as in `"odd": 1`, is passed
// over where the list is read, rather than failing the whole parse.
type Versions = { [name: string]: string | f64 | boolean | null };

// The fields of a package.json read here. Fish checks them as it parses; TypeScript doesn't, so
// each is still checked where it is read.
type PackageFields = {
  dependencies?: Versions; devDependencies?: Versions; optionalDependencies?: Versions; gypfile?: boolean;
};

const isObject = (v: Ref<unknown>): boolean => typeof v === "object" && v !== null && !Array.isArray(v);

// What a failed read or parse says, or `otherwise` for what isn't an Error, as Fish's JsonError
// and IoError aren't.
function messageOf(e: Ref<unknown>, otherwise: string): string {
  return e instanceof Error ? e.message : otherwise;
}

// A package.json's fields, or why it can't be read. A file whose fields have other types than
// these reads as having none of them.
/** @throws {IoError} */
function readPackage(path: string): PackageFields | string {
  const text = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  try {
    const v: unknown = JSON.parse(text);
    if (!isObject(v)) return "it isn't an object";
  } catch (e) {
    return messageOf(e, "it isn't JSON");
  }
  try {
    return JSON.parse<PackageFields>(text);
  } catch (_e) {
    return {};
  }
}

// The project's dependencies, or nothing when it has no package.json.
export function dependencies(dir: string): Dependencies | undefined {
  const path = join(dir, "package.json");
  if (!existsSync(path)) return undefined;
  let counts: Record<Group, usize> = { std: 0, planned: 0, native: 0, pure: 0, unknown: 0 };
  let manifest: PackageFields = {};
  try {
    const read = readPackage(path);
    if (typeof read === "string") return { counts, list: [], problem: `package.json can't be read: ${read}` };
    manifest = read;
  } catch (e) {
    return { counts, list: [], problem: `package.json can't be read: ${messageOf(e, "it can't be opened")}` };
  }
  // A package in both lists counts once, as the dependency it is at run time.
  const runtime = named(manifest.dependencies, false);
  let devs = named(manifest.devDependencies, true);
  let devOnly: Named[] = [];
  while (devs.length > 0) {
    const d = devs.shift()!;
    if (!runtime.some((r) => r.name === d.name)) devOnly.push(d);
  }
  let list: Dependency[] = [];
  for (const { name, version, dev } of [...runtime, ...devOnly]) {
    const kind = kindOf(installed(dir, name));
    const equivalent = EQUIVALENTS.get(name);
    let group: Group = kind;
    if (equivalent !== undefined) group = equivalent.planned ? "planned" : "std";
    bump(counts, group);
    let d: Dependency = { name, version, dev, group, kind };
    if (equivalent !== undefined) d.equivalent = equivalent;
    list.push(d);
  }
  // Yarn's Plug'n'Play keeps packages in zip archives, with no node_modules to read.
  const pnp = existsSync(join(dir, ".pnp.cjs")) && !existsSync(join(dir, "node_modules"));
  let result: Dependencies = { counts, list };
  if (pnp) result.problem = "this project installs with Yarn Plug'n'Play, whose packages Fish can't read, so they show as not installed";
  return result;
}

type Named = { name: string; version: string; dev: boolean };

function named(deps: Ref<Versions | undefined>, dev: boolean): Named[] {
  let out: Named[] = [];
  if (deps === undefined || !isObject(deps)) return out;
  for (const [name, version] of Object.entries(deps)) {
    if (typeof version === "string") out.push({ name, version, dev });
  }
  return out;
}

function bump(counts: Mut<Record<Group, usize>>, g: Group) {
  switch (g) {
    case "std": counts.std++; break;
    case "planned": counts.planned++; break;
    case "native": counts.native++; break;
    case "pure": counts.pure++; break;
    case "unknown": counts.unknown++; break;
  }
}

function countOf(counts: Ref<Record<Group, usize>>, g: Group): usize {
  if (g === "std") return counts.std;
  if (g === "planned") return counts.planned;
  if (g === "native") return counts.native;
  if (g === "pure") return counts.pure;
  return counts.unknown;
}

// Where a package is installed, found as Node finds it: in the project's node_modules or that of
// any directory above it, where package managers hoist shared dependencies.
function installed(dir: string, name: string): string {
  for (let at = resolve(dir); ; at = dirname(at)) {
    const path = join(at, "node_modules", name);
    if (existsSync(join(path, "package.json")) || dirname(at) === at) return path;
  }
}

function keysOf(deps: Ref<Versions | undefined>): string[] {
  if (deps === undefined || !isObject(deps)) return [];
  return Object.keys(deps);
}

// Whether an installed package is a native addon, plain JavaScript, or not installed.
function kindOf(dir: string): "native" | "pure" | "unknown" {
  let pkg: PackageFields = {};
  try {
    const read = readPackage(join(dir, "package.json"));
    if (typeof read === "string") {
      // A package.json that isn't an object still parsed, and reads as one with no fields.
      if (read !== "it isn't an object") return "unknown";
    } else {
      pkg = read;
    }
  } catch (_e) {
    return "unknown";
  }
  if (pkg.gypfile === true || existsSync(join(dir, "binding.gyp"))) return "native";
  // Only what installs with it counts: an installed package's dev dependencies never do.
  const optional = keysOf(pkg.optionalDependencies);
  if ([...keysOf(pkg.dependencies), ...optional].some((d) => NATIVE_HELPERS.has(d))) return "native";
  // Prebuilt N-API packages list one package per platform as optional dependencies.
  if (optional.some((d) => PLATFORMS.test(d))) return "native";
  return hasAddon(dir, 2) ? "native" : "pure";
}

// Whether a compiled `.node` file sits in a directory or the levels below it. Entries are read
// with lstat, as a directory listing's entry types are, so a symlink is neither.
function hasAddon(dir: string, depth: usize): boolean {
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch (_e) {
    return false;
  }
  for (const name of names) {
    let file = false;
    let directory = false;
    try {
      const st = lstatSync(join(dir, name));
      file = st.isFile();
      directory = st.isDirectory();
    } catch (_e) {
      continue;
    }
    if (file && name.endsWith(".node")) return true;
    if (directory && depth > 0 && name !== "node_modules" && hasAddon(join(dir, name), depth - 1)) return true;
  }
  return false;
}

const GROUPS: Group[] = ["std", "planned", "native", "pure", "unknown"];

function groupTitle(g: Group): string {
  if (g === "std") return "in std";
  if (g === "unknown") return "not installed";
  return g;
}

export function formatDependencies(d: Ref<Dependencies>): string[] {
  const problem = d.problem;
  if (problem !== undefined && problem !== "" && d.list.length === 0) return ["", "dependencies", `  ${problem}`];
  const dev = d.list.filter((x) => x.dev).length;
  let lines = ["", `dependencies (${d.list.length}${dev > 0 ? `, ${dev} dev` : ""})`];
  if (problem !== undefined && problem !== "") lines.push(`  ${problem}`);
  for (const g of GROUPS) {
    if (countOf(d.counts, g) === 0) continue;
    const members = d.list.filter((x) => x.group === g);
    let names: string[] = [];
    for (const x of members.slice(0, 10)) {
      const e: Ref<Equivalent | undefined> = x.equivalent;
      names.push(e !== undefined ? `${x.name} (${e.name})` : x.name);
    }
    const more = members.length > 10 ? `, and ${members.length - 10} more` : "";
    lines.push(`  ${`${groupTitle(g)}:`.padEnd(15)}${String(members.length).padStart(4)}  ${names.join(", ")}${more}`);
  }
  return lines;
}
