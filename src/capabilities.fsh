// What a program's dependencies reach beyond computing, found in their files, and the check that
// each stays within what its own fish.toml states and what the program grants it.
import { CompileError } from "./diag.fsh";
import type { Package } from "./dependencies.fsh";
import type { Capability } from "./manifest.fsh";
import type { Loaded, Module } from "./modules.fsh";
import { specifierOf } from "./modules.fsh";
import type { Stmt } from "./parser.fsh";
import { forEachChild, type AnyNode } from "./walk.fsh";

// One place a package's code needs a capability, and what is there; `through` names the
// dependency a use came in by.
type Use = { capability: Capability; start: usize; end: usize; what: string; through?: string };
type Uses = Map<Capability, Use>;

// The std modules that reach outside the program, by the name `stdModule` gives.
const BY_MODULE = new Map<string, Capability>([
  ["fs", "fs"], ["fs/promises", "fs"], ["sqlite", "fs"], ["tar", "fs"], ["zip", "fs"], ["sim", "fs"],
  ["child_process", "spawn"],
  ["tls", "net"], ["postgres", "net"], ["redis", "net"], ["grpc", "net"], ["s3", "net"],
]);

// Std's prelude names that open connections or listen, reached without an import.
const NET_NAMES = new Set<string>(["fetch", "serve", "Router"]);

// What Bun's module needs when a file takes it whole.
const BUN_ALL: Capability[] = ["fs", "spawn", "net"];

// What a member of Bun's module needs, when it needs anything.
function bunMember(name: string): Capability | undefined {
  if (name === "file" || name === "write") return "fs";
  if (name === "spawn" || name === "spawnSync" || name === "Subprocess" || name === "SyncSubprocess") return "spawn";
  if (name === "serve") return "net";
  return undefined;
}

function note(found: Mut<Uses>, capability: Capability | undefined, start: usize, end: usize, what: string): void {
  if (capability !== undefined && !found.has(capability)) found.set(capability, { capability, start, end, what });
}

// The names a file declares or imports at its top, which hide std's prelude names.
// ponytail: top-level names only, so a local `fetch` inside a function still counts as net.
function topNames(statements: Ref<Stmt[]>): Set<string> {
  let names = new Set<string>();
  for (const s of statements) {
    const d: Ref<Stmt> = s.kind === "export" ? s.body : s;
    if (d.kind === "import") {
      if (d.default !== undefined) names.add(d.default);
      if (d.namespace !== undefined) names.add(d.namespace);
      if (d.named !== undefined) for (const sp of d.named) names.add(sp.alias !== undefined ? sp.alias : sp.name);
    } else if (d.kind === "function") names.add(d.name);
    else if (d.kind === "class" && d.name !== undefined) names.add(d.name);
    else if (d.kind === "let") for (const x of d.declarations) if (x.target.kind === "ident") names.add(x.target.name);
  }
  return names;
}

function walkUses(n: AnyNode, top: Ref<Set<string>>, globals: Ref<Map<string, Module>>, found: Mut<Uses>): void {
  if (n.of === "stmt") {
    const s = n.node;
    if (s.kind === "unsafe") note(found, "unsafe", s.start, s.end, "an unsafe block");
    else if (s.kind === "declare" && s.body.kind === "function" && s.body.body === undefined) note(found, "ffi", s.start, s.end, "a C function's declaration");
    else if (s.kind === "class" && s.derives !== undefined && s.derives.includes("C")) note(found, "ffi", s.start, s.end, "a @c struct");
  } else if (n.of === "expr") {
    const e = n.node;
    if (e.kind === "unsafe") note(found, "unsafe", e.start, e.end, "an unsafe expression");
    else if (e.kind === "ident" && NET_NAMES.has(e.name) && !top.has(e.name)) note(found, "net", e.start, e.end, `'${e.name}'`);
    else if (e.kind === "member" && e.object.kind === "ident" && globals.has(e.object.name) && !top.has(e.object.name)) {
      const name = e.object.name;
      note(found, name === "Bun" ? bunMember(e.name) : BY_MODULE.get(name), e.start, e.end, `'${name}.${e.name}'`);
    }
  }
  forEachChild(n, (c) => walkUses(c, top, globals, found));
}

// What one file of a dependency uses: the modules it imports, then what its code does.
function usesOf(m: Ref<Module>): Uses {
  let found: Uses = new Map();
  for (const s of m.statements) {
    const specifier = specifierOf(s);
    if (specifier === undefined) continue;
    const target = m.targets.get(s);
    if (target === undefined) continue;
    const what = `importing '${specifier}'`;
    if (target.path.startsWith("pkg:")) note(found, "ffi", s.start, s.end, `${what}, an npm package`);
    else if (target.path.startsWith("rust:")) note(found, "ffi", s.start, s.end, `${what}, a Rust crate`);
    else if (target.path === "std:Bun") {
      // Named imports say which members it takes; a whole import may take any.
      const named = s.kind === "import" && s.namespace === undefined && s.default === undefined;
      if (named && s.kind === "import" && s.named !== undefined) for (const sp of s.named) note(found, bunMember(sp.name), s.start, s.end, what);
      else for (const c of BUN_ALL) note(found, c, s.start, s.end, what);
    } else if (target.path.startsWith("std:")) note(found, BY_MODULE.get(target.path.slice("std:".length as i64)), s.start, s.end, what);
  }
  walkUses({ of: "stmts", node: m.statements }, topNames(m.statements), m.globals, found);
  return found;
}

// What the package at `dir` uses, its own and through its dependencies, the first place of each.
function effective(dir: string, packages: Ref<Package[]>, own: Ref<Map<string, Uses>>): Uses {
  let all: Uses = new Map();
  const mine = own.get(dir);
  if (mine !== undefined) for (const [c, u] of mine) all.set(c, { ...u });
  for (const p of packages) {
    if (p.dir !== dir) continue;
    for (const [name, depDir] of p.deps) {
      for (const [c, u] of effective(depDir, packages, own)) if (!all.has(c)) all.set(c, { ...u, through: u.through ?? name });
    }
  }
  return all;
}

function quoted(cs: Ref<Capability[]>): string {
  return cs.map((c) => `"${c}"`).join(", ");
}

function where(u: Ref<Use>): string {
  return u.through !== undefined ? `through its dependency '${u.through}', by ${u.what}` : `by ${u.what}`;
}

// Refuses a dependency using a capability that its own fish.toml doesn't state, or that the
// program's doesn't grant it. The program's own package may use anything.
/** @throws {CompileError} */
export function checkCapabilities(loaded: Ref<Loaded>): void {
  const packages: Ref<Package[] | undefined> = loaded.fish;
  if (packages === undefined || packages.length < 2) return;
  const root: Ref<Package> = packages[0]!;
  let own = new Map<string, Uses>();
  for (const m of loaded.modules) {
    if (m.pkg === undefined || m.pkg === root.dir || m.path.startsWith("std:")) continue;
    let had = own.get(m.pkg);
    let uses: Uses = had !== undefined ? had : new Map();
    for (const [c, u] of usesOf(m)) if (!uses.has(c)) uses.set(c, { ...u });
    own.set(m.pkg, uses);
  }
  for (let i: usize = 1; i < packages.length; i++) {
    const p: Ref<Package> = packages[i]!;
    for (const [c, u] of effective(p.dir, packages, own)) {
      if (p.manifest.capabilities.includes(c)) continue;
      const wanted: Capability[] = [...p.manifest.capabilities, c];
      throw new CompileError("E0910", `the package '${p.manifest.name}' uses ${c} here, ${where(u)}, which its fish.toml doesn't state; a package lists what it uses under [package], as in capabilities = [${quoted(wanted)}]`, u.start, u.end);
    }
  }
  for (const dep of root.manifest.dependencies) {
    const dir = root.deps.get(dep.name);
    if (dir === undefined) continue;
    const given: Ref<Capability[] | undefined> = dep.capabilities;
    const granted: Capability[] = given !== undefined ? [...given] : [];
    for (const [c, u] of effective(dir, packages, own)) {
      if (granted.includes(c)) continue;
      const wanted: Capability[] = [...granted, c];
      throw new CompileError("E0910", `this program doesn't grant the dependency '${dep.name}' ${c}, which it uses here, ${where(u)}; grant it in fish.toml with capabilities = [${quoted(wanted)}] under [dependencies.${dep.name}], or depend on something that doesn't need it`, u.start, u.end);
    }
  }
}
