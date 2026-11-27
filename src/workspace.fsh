import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { CompileError } from "./diag.fsh";
import { dependenciesIn, inManifest, MANIFEST, parseToml, readManifest, type Dependency, type Manifest, type SpannedValue } from "./manifest.fsh";

// A package of a workspace, by its name and real directory.
export type Member = { name: string; dir: string };

// A workspace: its root's real directory and manifest, its members in the order `members` lists
// them, the root's own package first when it has one, and its [workspace.dependencies].
export type Workspace = { dir: string; file: string; members: Member[]; dependencies: Dependency[] };

const FORM = "a member is a directory inside the workspace, or a pattern ending in one '*', as in members = [\"app\", \"crates/*\"]";

// Reads the workspace whose root manifest is `file`, finding and checking every member. Errors
// render against the manifest they are about.
/** @throws {CompileError | IoError} */
export function readWorkspace(file: string): Workspace {
  const src = readFileSync(file, "utf8");
  const root = realpathSync(dirname(file));
  try {
    const tables = parseToml(src);
    const table = tables.get("workspace");
    if (table === undefined || Array.isArray(table)) throw new CompileError("E0905", `${MANIFEST} has no [workspace] table`, 0, 1);
    for (const { key } of table.keys.values()) {
      if (key.value !== "members") throw new CompileError("E0905", `[workspace] has no key '${key.value}'; it has members, and [workspace.dependencies] beside it`, key.start, key.end);
    }
    const pkg = tables.get("package");
    if (pkg === undefined) {
      // With no package of its own, the root manifest is only the workspace.
      for (const [name, found] of tables) {
        if (name === "" || name === "workspace" || name === "registry" || name === "workspace.dependencies" || name.startsWith("workspace.dependencies.")) continue;
        const start = Array.isArray(found) ? found[0]!.start : found.start;
        const end = Array.isArray(found) ? found[0]!.end : found.end;
        throw new CompileError("E0905", `[${name}] belongs to a package, and this workspace's root has no [package]; it has [workspace], [workspace.dependencies] and [registry]`, start, end);
      }
    }
    let members: Member[] = [];
    if (pkg !== undefined) members.push({ name: readManifest(src, root).name, dir: root });
    const listed = table.keys.get("members");
    if (listed === undefined) throw new CompileError("E0905", "[workspace] needs members, the directories of its packages, as in members = [\"app\", \"crates/*\"]", table.start, table.end);
    const list: Ref<SpannedValue> = listed.value;
    if (!Array.isArray(list.value)) throw new CompileError("E0905", FORM, list.start, list.end);
    for (const v of list.value) {
      if (typeof v.value !== "string") throw new CompileError("E0905", FORM, v.start, v.end);
      for (const dir of memberDirs(root, v.value, v.start, v.end)) {
        if (members.some((m) => m.dir === dir)) continue;
        const name = memberName(dir);
        const other = members.find((m) => m.name === name);
        if (other !== undefined) throw new CompileError("E0905", `two members are named '${name}', at '${shown(root, other.dir)}' and '${shown(root, dir)}'; a name is one package in a workspace`, v.start, v.end);
        members.push({ name, dir });
      }
    }
    let dependencies: Dependency[] = dependenciesIn(tables, "workspace.dependencies");
    for (const d of dependencies) {
      if ("workspace" in d) throw new CompileError("E0905", `'${d.name}' is the workspace's own declaration, so it says where it comes from rather than workspace = true`, d.start, d.end);
    }
    return { dir: root, file: join(root, MANIFEST), members, dependencies };
  } catch (e) {
    if (e instanceof CompileError) throw inManifest(e, file, src);
    throw e;
  }
}

// The real directories one `members` string names: a path, or every package directory matching
// a `*` in its last part.
/** @throws {CompileError | IoError} */
function memberDirs(root: string, written: string, start: usize, end: usize): string[] {
  if (written === "" || isAbsolute(written) || normalize(written).split(sep)[0] === "..") throw new CompileError("E0905", FORM, start, end);
  let dirs: string[] = [];
  if (!written.includes("*")) {
    const dir = resolve(root, written);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new CompileError("E0905", `the member '${written}' doesn't exist; make a package there with 'fishc new', or leave it out`, start, end);
    if (!existsSync(join(dir, MANIFEST))) throw new CompileError("E0905", `the member '${written}' has no ${MANIFEST}; make a package there with 'fishc init', or leave it out`, start, end);
    dirs.push(inside(root, realpathSync(dir), start, end));
    return dirs;
  }
  const parent = dirname(written);
  const pattern = written.slice((parent === "." && !written.startsWith("./") ? 0 : parent.length + 1) as i64);
  if (parent.includes("*") || pattern.split("*").length > 2) throw new CompileError("E0905", FORM, start, end);
  const under = resolve(root, parent);
  if (!existsSync(under) || !statSync(under).isDirectory()) throw new CompileError("E0905", `the members '${written}' look in '${parent}', which doesn't exist`, start, end);
  const parts = pattern.split("*");
  const before = parts[0]!;
  const after = parts[1]!;
  let names = readdirSync(under).filter((n) => !n.startsWith(".") && n.startsWith(before) && n.endsWith(after) && n.length >= before.length + after.length);
  names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  // A pattern takes the directories that are packages and passes over anything else there.
  for (const n of names) {
    const dir = join(under, n);
    if (statSync(dir).isDirectory() && existsSync(join(dir, MANIFEST))) dirs.push(inside(root, realpathSync(dir), start, end));
  }
  return dirs;
}

// `dir`, once it is known to be inside the workspace's root, links followed.
/** @throws {CompileError} */
function inside(root: string, dir: string, start: usize, end: usize): string {
  if (dir !== root && !dir.startsWith(root + sep)) throw new CompileError("E0905", `the member at '${dir}' is outside the workspace; ${FORM}`, start, end);
  return dir;
}

// A member's package name, read as written, with nothing inherited: reading what it inherits would
// read this workspace again.
/** @throws {CompileError | IoError} */
function memberName(dir: string): string {
  const file = join(dir, MANIFEST);
  const src = readFileSync(file, "utf8");
  try {
    const found = parseToml(src).get("workspace");
    if (found !== undefined) {
      const start = Array.isArray(found) ? found[0]!.start : found.start;
      const end = Array.isArray(found) ? found[0]!.end : found.end;
      throw new CompileError("E0905", "this package is a member of a workspace, so it can't be a workspace itself; list its members in the outer one", start, end);
    }
    return readManifest(src, dir).name;
  } catch (e) {
    if (e instanceof CompileError) throw inManifest(e, file, src);
    throw e;
  }
}

function shown(root: string, dir: string): string {
  const near = relative(root, dir);
  return near !== "" ? near : ".";
}

// Whether the manifest at `file` has a [workspace] table, read only when it might.
/** @throws {IoError} */
function hasWorkspace(file: string): boolean {
  const src = readFileSync(file, "utf8");
  if (!src.includes("workspace")) return false;
  try {
    return parseToml(src).has("workspace");
  } catch (_e) {
    // A manifest that doesn't read is reported by whatever reads it as a package.
    return false;
  }
}

// The nearest workspace root at or above `from`, whether or not it lists `from`.
/** @throws {CompileError | IoError} */
export function workspaceAbove(from: string): Workspace | undefined {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    const file = join(dir, MANIFEST);
    if (existsSync(file) && hasWorkspace(file)) return readWorkspace(file);
    if (dirname(dir) === dir) return undefined;
  }
}

// The workspace the package in `dir` is a member of: the nearest one at or above it, when that one
// lists it. A package a workspace doesn't list is a package on its own.
/** @throws {CompileError | IoError} */
export function workspaceOf(dir: string): Workspace | undefined {
  const real = realpathSync(dir);
  const found = workspaceAbove(real);
  return found !== undefined && found.members.some((m) => m.dir === real) ? found : undefined;
}

// `manifest` with each `{ workspace = true }` dependency replaced by its workspace's entry, a path
// rewritten to lead from the member, and the member's capabilities kept when it gives them.
/** @throws {CompileError | IoError} */
export function inherited(manifest: Manifest): Manifest {
  if (!manifest.dependencies.some((d) => "workspace" in d)) return manifest;
  const ws = workspaceOf(manifest.dir);
  let deps: Dependency[] = [];
  for (const d of [...manifest.dependencies]) {
    if (!("workspace" in d)) {
      deps.push(d.clone());
      continue;
    }
    if (ws === undefined) throw new CompileError("E0905", `'${d.name}' comes from the workspace, but this package isn't a member of one; say where it comes from instead`, d.start, d.end);
    const shared = ws.dependencies.find((w) => w.name === d.name);
    if (shared === undefined) throw new CompileError("E0905", `the workspace's [workspace.dependencies] has no '${d.name}'; declare it there`, d.start, d.end);
    const own = d.capabilities.clone();
    const given = shared.capabilities.clone();
    const capabilities = own !== undefined ? [...own] : given !== undefined ? [...given] : undefined;
    if ("version" in shared) deps.push({ name: d.name, start: d.start, end: d.end, capabilities, version: shared.version });
    else if ("path" in shared) {
      const near = relative(realpathSync(manifest.dir), resolve(ws.dir, shared.path));
      deps.push({ name: d.name, start: d.start, end: d.end, capabilities, path: near !== "" ? near : "." });
    } else if ("git" in shared) deps.push({ name: d.name, start: d.start, end: d.end, capabilities, git: shared.git, rev: shared.rev });
  }
  let out = manifest;
  out.dependencies = deps;
  return out;
}
