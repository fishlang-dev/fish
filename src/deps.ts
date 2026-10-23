import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// The dependencies a project's package.json names, sorted by what a port to Fish does with them:
// replace them with Fish's std, wait for a planned feature that replaces them, give up on native
// addons, or bring pure JavaScript and TypeScript across. Only the installed copies are read.

export type Group = "std" | "planned" | "native" | "pure" | "unknown";
export type Dependency = {
  name: string; version: string; dev: boolean; group: Group; kind: "native" | "pure" | "unknown";
  equivalent?: { name: string; planned: boolean };
};
export type Dependencies = { counts: Record<Group, number>; list: Dependency[]; problem?: string };

// What replaces a package: Fish's std, or a planned feature named by its title.
const IN_STD = (name: string) => ({ name, planned: false });
const PLANNED = (title: string) => ({ name: title, planned: true });
const EQUIVALENTS: Record<string, { name: string; planned: boolean }> = {
  ...Object.fromEntries(["express", "hono", "fastify", "koa", "polka", "restify", "@hono/node-server"].map((p) => [p, IN_STD("serve and Router")])),
  "async-mutex": IN_STD("Lock"), "p-limit": IN_STD("Semaphore"), "abort-controller": IN_STD("AbortController"),
  ...Object.fromEntries(["node-fetch", "axios", "undici", "got", "cross-fetch", "superagent", "ky"].map((p) => [p, PLANNED("HTTP client")])),
  ...Object.fromEntries(["commander", "yargs", "minimist", "meow", "cac"].map((p) => [p, PLANNED("Typed CLI arguments")])),
  ...Object.fromEntries(["dotenv", "env-var"].map((p) => [p, PLANNED("Typed configuration from the environment")])),
  ...Object.fromEntries(["ws", "socket.io"].map((p) => [p, PLANNED("WebSockets")])),
  ...Object.fromEntries(["uuid", "nanoid"].map((p) => [p, PLANNED("Randomness")])),
  ...Object.fromEntries(["dayjs", "date-fns", "moment", "luxon"].map((p) => [p, PLANNED("Date parsing and formatting")])),
  ...Object.fromEntries(["pino", "winston", "bunyan"].map((p) => [p, PLANNED("Structured logging")])),
  ...Object.fromEntries(["pg", "postgres"].map((p) => [p, PLANNED("Postgres driver")])),
  ...Object.fromEntries(["better-sqlite3", "sqlite3"].map((p) => [p, PLANNED("SQLite binding")])),
  ...Object.fromEntries(["ioredis", "redis"].map((p) => [p, PLANNED("Redis client")])),
  ...Object.fromEntries(["glob", "fast-glob", "globby"].map((p) => [p, PLANNED("Glob")])),
  "fs-extra": PLANNED("Async file I/O"), chokidar: PLANNED("File watching"), tmp: PLANNED("Temporary files and directories"),
  ...Object.fromEntries(["execa", "cross-spawn"].map((p) => [p, PLANNED("Process spawning")])),
  ...Object.fromEntries(["node-cron", "cron"].map((p) => [p, PLANNED("Scheduled jobs")])),
  cors: PLANNED("CORS middleware"), compression: PLANNED("Response compression"), "express-rate-limit": PLANNED("Rate-limiting middleware"),
  ...Object.fromEntries(["cookie", "cookie-parser"].map((p) => [p, PLANNED("Cookies")])),
  ...Object.fromEntries(["marked", "markdown-it"].map((p) => [p, PLANNED("Markdown to HTML")])),
  ...Object.fromEntries(["sanitize-html", "dompurify"].map((p) => [p, PLANNED("HTML sanitization")])),
  ...Object.fromEntries(["csv-parse", "papaparse"].map((p) => [p, PLANNED("CSV reading and writing")])),
  nodemailer: PLANNED("SMTP email client"), eventemitter3: PLANNED("EventTarget and EventEmitter"),
  ...Object.fromEntries(["inquirer", "prompts"].map((p) => [p, PLANNED("Interactive prompts")])),
  ...Object.fromEntries(["jest", "vitest", "mocha"].map((p) => [p, PLANNED("Test runner")])),
  "@grpc/grpc-js": PLANNED("gRPC"), "@aws-sdk/client-s3": PLANNED("S3-compatible storage client"), bcryptjs: PLANNED("Hashing"),
};

// Packages a native addon builds or loads its compiled code through.
const NATIVE_HELPERS = new Set(["node-gyp-build", "bindings", "node-addon-api", "prebuild", "prebuild-install", "nan", "node-pre-gyp", "@mapbox/node-pre-gyp"]);
const PLATFORMS = /(darwin|linux|win32|freebsd|android)/;

// The project's dependencies, or nothing when it has no package.json.
export function dependencies(dir: string): Dependencies | undefined {
  const path = join(dir, "package.json");
  if (!existsSync(path)) return undefined;
  const counts: Record<Group, number> = { std: 0, planned: 0, native: 0, pure: 0, unknown: 0 };
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(readFileSync(path, "utf8"));
    if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) throw new Error("it isn't an object");
  } catch (e) {
    return { counts, list: [], problem: `package.json can't be read: ${e instanceof Error ? e.message : e}` };
  }
  const named = (field: string, dev: boolean) => {
    const deps = manifest[field];
    return typeof deps === "object" && deps !== null ? Object.entries(deps).map(([name, version]) => ({ name, version: String(version), dev })) : [];
  };
  const list = [...named("dependencies", false), ...named("devDependencies", true)].map(({ name, version, dev }) => {
    const kind = kindOf(installed(dir, name));
    const equivalent = EQUIVALENTS[name];
    const group: Group = equivalent ? (equivalent.planned ? "planned" : "std") : kind;
    counts[group]++;
    return { name, version, dev, group, kind, ...(equivalent && { equivalent }) };
  });
  return { counts, list };
}

// Where a package is installed, found as Node finds it: in the project's node_modules or that of
// any directory above it, where package managers hoist shared dependencies.
function installed(dir: string, name: string): string {
  for (let at = resolve(dir); ; at = dirname(at)) {
    const path = join(at, "node_modules", name);
    if (existsSync(join(path, "package.json")) || dirname(at) === at) return path;
  }
}

// Whether an installed package is a native addon, plain JavaScript, or not installed.
function kindOf(dir: string): "native" | "pure" | "unknown" {
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  } catch {
    return "unknown";
  }
  const names = (field: string) => (typeof pkg[field] === "object" && pkg[field] !== null ? Object.keys(pkg[field] as object) : []);
  if (pkg.gypfile === true || existsSync(join(dir, "binding.gyp"))) return "native";
  if ([...names("dependencies"), ...names("devDependencies")].some((d) => NATIVE_HELPERS.has(d))) return "native";
  // Prebuilt N-API packages list one package per platform as optional dependencies.
  if (names("optionalDependencies").some((d) => PLATFORMS.test(d))) return "native";
  return hasAddon(dir, 2) ? "native" : "pure";
}

// Whether a compiled `.node` file sits in a directory or the levels below it.
function hasAddon(dir: string, depth: number): boolean {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  return entries.some((e) => (e.isFile() && e.name.endsWith(".node")) || (e.isDirectory() && depth > 0 && e.name !== "node_modules" && hasAddon(join(dir, e.name), depth - 1)));
}

const GROUP_TITLES: Record<Group, string> = { std: "in std", planned: "planned", native: "native", pure: "pure", unknown: "not installed" };

export function formatDependencies(d: Dependencies): string[] {
  if (d.problem) return ["", "dependencies", `  ${d.problem}`];
  const dev = d.list.filter((x) => x.dev).length;
  return [
    "",
    `dependencies (${d.list.length}${dev ? `, ${dev} dev` : ""})`,
    ...(Object.keys(GROUP_TITLES) as Group[]).filter((g) => d.counts[g] > 0).map((g) => {
      const members = d.list.filter((x) => x.group === g);
      const names = members.slice(0, 10).map((x) => (x.equivalent ? `${x.name} (${x.equivalent.name})` : x.name));
      const more = members.length > 10 ? `, and ${members.length - 10} more` : "";
      return `  ${`${GROUP_TITLES[g]}:`.padEnd(15)}${String(members.length).padStart(4)}  ${names.join(", ")}${more}`;
    }),
  ];
}
