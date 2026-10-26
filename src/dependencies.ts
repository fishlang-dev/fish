import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { CompileError } from "./diag.ts";
import { cacheDir } from "./mathlib.ts";
import { findManifest, inManifest, loadManifest, MANIFEST, parseToml, type Dependency, type Manifest, type Table } from "./manifest.ts";

// A Fish package of a program: its manifest, its real directory, the packages its dependencies
// name, by the names it imports them under, and for one from git, the commit it was fetched at.
export type Package = { manifest: Manifest; dir: string; deps: Map<string, Package>; git?: { url: string; commit: string } };

// The packages a program whose entry is `entry` is built from, the one holding the entry first,
// or none when no `fish.toml` is at or above it. Each package's dependencies come from its own
// manifest; a package reached twice from the same place is one package.
export function resolvePackages(entry: string): Package[] | undefined {
  const file = findManifest(dirname(resolve(entry)));
  if (!file) return undefined;
  const root: Package = { manifest: loadManifest(file), dir: realpathSync(dirname(file)), deps: new Map() };
  const byDir = new Map([[root.dir, root]]);
  const byName = new Map([[root.manifest.name, root]]);
  const visit = (pkg: Package, path: Package[]) => {
    for (const dep of pkg.manifest.dependencies) {
      const where = join(pkg.dir, MANIFEST);
      const fail = (message: string) => inManifest(new CompileError(message, dep.start, dep.end), where);
      // What a commit pins can't reach past it to files on this machine.
      if (pkg.git && "path" in dep) throw fail(`'${pkg.manifest.name}' comes from git, so its dependencies must too; a path dependency would bring in files its commit doesn't pin`);
      const [dir, git] = "path" in dep ? [located(pkg, dep, fail)] : fetched(dep, fail);
      const chain = [...path, pkg];
      const cycle = chain.findIndex((p) => p.dir === dir);
      if (cycle >= 0) throw fail(`'${dep.name}' depends back on '${pkg.manifest.name}': ${chain.slice(cycle).map((p) => p.manifest.name).join(" -> ")} -> ${dep.name}; packages can't depend on each other in a cycle`);
      // One commit is one package, however much of its hash a manifest wrote.
      let found = byDir.get(dir) ?? (git && [...byDir.values()].find((p) => p.git?.url === git.url && p.git.commit === git.commit));
      if (!found) {
        if (git && !existsSync(join(dir, MANIFEST))) throw fail(`'${git.url}' has no ${MANIFEST} at its top, so it isn't a Fish package`);
        found = { manifest: loadManifest(join(dir, MANIFEST), "lib"), dir, deps: new Map(), ...(git && { git }) };
        named(found, dep.name, pkg, fail);
        const other = byName.get(dep.name);
        if (other) throw fail(`'${dep.name}' already comes from '${relative(pkg.dir, other.dir)}' in this program, so it can't also come from '${relative(pkg.dir, dir)}'`);
        byDir.set(dir, found);
        byName.set(dep.name, found);
        visit(found, chain);
      }
      named(found, dep.name, pkg, fail);
      pkg.deps.set(dep.name, found);
    }
  };
  visit(root, []);
  const packages = [...byDir.values()];
  lock(packages);
  return packages;
}

export const LOCKFILE = "fish.lock";

// Whether a build may change `fish.lock`; `fishc build --locked` says it may not, for CI.
export const locking = { locked: false };

// Writes `fish.lock` beside the root package's manifest when what it resolves to has changed,
// after checking that each git package's files still hash to what the lock recorded.
function lock(packages: Package[]) {
  const [root, ...deps] = packages;
  const file = join(root!.dir, LOCKFILE);
  const had = existsSync(file) ? readFileSync(file, "utf8") : undefined;
  if (deps.length === 0 && had === undefined) return;
  const recorded = had === undefined ? new Map<string, Table>() : locked(file, had);
  const entries = deps.map((p) => {
    const source = p.git ? `git+${p.git.url}#${p.git.commit}` : `path+${relative(root!.dir, p.dir) || "."}`;
    const checksum = p.git ? `sha256:${checksumOf(p.dir)}` : undefined;
    const before = recorded.get(p.manifest.name);
    const was = before?.keys.get("checksum")?.value.value;
    if (checksum && before?.keys.get("source")?.value.value === source && was !== checksum) {
      throw inManifest(new CompileError(`the files of '${p.manifest.name}' at ${p.dir} no longer match its checksum in ${LOCKFILE}; delete that directory to fetch it again`, before!.start, before!.end), file, had);
    }
    return { name: p.manifest.name, source, checksum };
  });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const text = ["# Written by fishc build; it records exactly which packages a build used.", "version = 1", ...entries.map((e) => `\n[[package]]\nname = "${e.name}"\nsource = ${JSON.stringify(e.source)}${e.checksum ? `\nchecksum = "${e.checksum}"` : ""}`)].join("\n") + "\n";
  if (text === had) return;
  if (locking.locked) throw inManifest(new CompileError(`${LOCKFILE} is out of date with ${MANIFEST}, and --locked keeps it as it is; build without --locked to update it, then commit it`, 0, 1), had === undefined ? join(root!.dir, MANIFEST) : file, had);
  // Written beside it and moved over it, so a build reading it never sees half a lock.
  const next = `${file}.${process.pid}.tmp`;
  writeFileSync(next, text);
  renameSync(next, file);
}

// A package is depended on by the name its own manifest gives it, however it was reached.
function named(found: Package, name: string, by: Package, fail: (message: string) => unknown) {
  if (found.manifest.name !== name) throw fail(`the package at '${relative(by.dir, found.dir) || "."}' is named '${found.manifest.name}' in its ${MANIFEST}, not '${name}'; depend on it by that name`);
}

// The packages a lockfile records, by name.
function locked(file: string, src: string): Map<string, Table> {
  try {
    const toml = parseToml(src);
    const version = (toml.get("") as Table).keys.get("version");
    if (version?.value.value !== 1) throw new CompileError(`this ${LOCKFILE} isn't one this fishc writes, version 1; a newer fishc may have written it`, version?.value.start ?? 0, version?.value.end ?? 1);
    const found = toml.get("package") ?? [];
    return new Map((Array.isArray(found) ? found : [found]).map((t) => [String(t.keys.get("name")?.value.value), t]));
  } catch (e) {
    throw inManifest(e, file, src);
  }
}

// The sha256 of a package's manifest and its .fsh files, by sorted relative path, so any change
// to what it builds from changes it.
export function checksumOf(dir: string): string {
  const hash = createHash("sha256");
  const walk = (at: string): string[] =>
    readdirSync(join(dir, at), { withFileTypes: true }).flatMap((e) => {
      const path = at ? `${at}/${e.name}` : e.name;
      if (e.isDirectory()) return e.name === ".git" || e.name === "target" ? [] : walk(path);
      // A link is hashed as where it points, so adding or changing one changes the sum.
      return e.isSymbolicLink() || (e.isFile() && (path === MANIFEST || e.name.endsWith(".fsh"))) ? [path] : [];
    });
  for (const path of walk("").sort()) {
    const at = join(dir, path);
    const link = linkTarget(at);
    hash.update(path).update("\0").update(link === undefined ? readFileSync(at) : `-> ${link}`).update("\0");
  }
  return hash.digest("hex");
}

// Where a symbolic link at `at` points, or undefined when it isn't one.
function linkTarget(at: string): string | undefined {
  try {
    return readlinkSync(at);
  } catch {
    return undefined;
  }
}

// The first symbolic link under `dir`, as a path inside it.
function firstLink(dir: string, at = ""): string | undefined {
  for (const e of readdirSync(join(dir, at), { withFileTypes: true })) {
    const path = at ? `${at}/${e.name}` : e.name;
    if (e.isSymbolicLink()) return path;
    const inner = e.isDirectory() ? firstLink(dir, path) : undefined;
    if (inner) return inner;
  }
  return undefined;
}

// The real directory a path dependency names, which must hold a Fish package.
function located(pkg: Package, dep: Extract<Dependency, { path: string }>, fail: (message: string) => unknown): string {
  const dir = resolve(pkg.dir, dep.path);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw fail(`can't find the directory '${dep.path}' for '${dep.name}'`);
  if (!existsSync(join(dir, MANIFEST))) throw fail(`'${dep.path}' has no ${MANIFEST}, so it isn't a Fish package`);
  return realpathSync(dir);
}

// A git dependency's files at its commit, fetched once into the cache and read from there after,
// each repository and commit in a directory of its own. The commit it resolved to is kept beside
// that directory, outside what the repository put in it.
function fetched(dep: Extract<Dependency, { git: string }>, fail: (message: string) => unknown): [string, { url: string; commit: string }] {
  const repo = join(cacheDir(), "git", `${dep.git.replace(/^[a-z+]+:\/\//, "").replace(/[^A-Za-z0-9._-]+/g, "-").slice(-60)}-${createHash("sha256").update(dep.git).digest("hex").slice(0, 12)}`);
  const dir = join(repo, dep.rev);
  const marker = `${dir}.commit`;
  if (!existsSync(marker) || !existsSync(dir)) {
    if (!Bun.which("git")) throw fail(`fetching '${dep.git}' needs the git command, which isn't on PATH; install git`);
    mkdirSync(repo, { recursive: true });
    const work = mkdtempSync(join(repo, ".fetch-"));
    try {
      // The user's own repository settings, as in a hook or CI, never reach this one.
      const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
      // Nor do the user's hooks or Git LFS, which a repository's own settings could point elsewhere.
      const quiet = ["-c", "core.hooksPath=/dev/null", "-c", "filter.lfs.process=", "-c", "filter.lfs.smudge=", "-c", "filter.lfs.required=false"];
      const git = (...args: string[]) => Bun.spawnSync(["git", ...quiet, ...args], { cwd: work, stderr: "pipe", stdout: "pipe", env: { ...env, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1" } });
      const clone = git("clone", "--quiet", "--no-checkout", "--", dep.git, ".");
      if (clone.exitCode !== 0) throw fail(`can't fetch '${dep.git}': ${firstLine(clone.stderr.toString())}`);
      // The commit whose hash starts with rev, never a branch or tag that happens to be named like it.
      const objects = git("rev-parse", "--disambiguate=" + dep.rev).stdout.toString().split("\n").filter((o) => o !== "");
      const commits = objects.filter((o) => git("cat-file", "-t", o).stdout.toString().trim() === "commit");
      if (commits.length === 0) throw fail(`'${dep.git}' has no commit '${dep.rev}'`);
      if (commits.length > 1) throw fail(`'${dep.rev}' starts the hashes of ${commits.length} commits of '${dep.git}'; give more of its digits`);
      const commit = commits[0]!;
      // `^{commit}` makes the full hash an object name, so a branch named like it can't stand in.
      if (git("-c", "advice.detachedHead=false", "checkout", "--quiet", "--detach", `${commit}^{commit}`).exitCode !== 0) throw fail(`can't check out '${dep.rev}' of '${dep.git}'`);
      if (git("rev-parse", "HEAD").stdout.toString().trim() !== commit) throw fail(`checking out '${dep.rev}' of '${dep.git}' gave another commit`);
      rmSync(join(work, ".git"), { recursive: true, force: true });
      const link = firstLink(work);
      if (link) throw fail(`'${dep.git}' holds a symbolic link at '${link}'; a package from git can't, since a link reaches files its commit doesn't pin`);
      // The commit is recorded first and the files moved into place whole, so a build sees both
      // only once the fetch is done; another build that fetched the same commit first has
      // already put the same files there.
      const next = `${marker}.${process.pid}.tmp`;
      writeFileSync(next, commit + "\n");
      renameSync(next, marker);
      try {
        renameSync(work, dir);
      } catch (e) {
        if (!existsSync(dir)) throw e;
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }
  const commit = readFileSync(marker, "utf8").trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) throw fail(`the cached copy of '${dep.git}' is damaged; delete ${dir} to fetch it again`);
  return [realpathSync(dir), { url: dep.git, commit }];
}

const firstLine = (text: string) => text.trim().split("\n").find((l) => l.trim() !== "")?.replace(/^fatal: /, "") ?? "git failed";

// The dependency package holding `file`, not the program's own, which may reach further.
export function dependencyOf(packages: Package[], file: string): Package | undefined {
  const real = realpathSync(file);
  const owner = packages.filter((p) => real.startsWith(p.dir + "/")).sort((a, b) => b.dir.length - a.dir.length)[0];
  return owner === packages[0] ? undefined : owner;
}

// The library file a bare import names, when the package holding the importing file depends on
// a Fish package of that name; undefined sends it on to npm's packages.
export function dependencyLib(packages: Package[], from: string, specifier: string, at: { start: number; end: number }): string | undefined {
  const file = realpathSync(from);
  const owner = packages.filter((p) => file.startsWith(p.dir + "/")).sort((a, b) => b.dir.length - a.dir.length)[0];
  if (!owner) return undefined;
  const scoped = specifier.startsWith("@");
  const name = specifier.split("/").slice(0, scoped ? 2 : 1).join("/");
  const dep = owner.deps.get(name);
  if (!dep) return undefined;
  if (name !== specifier) throw new CompileError(`importing a file inside the package '${name}' isn't supported yet; import from '${name}' itself`, at.start, at.end);
  return join(dep.dir, dep.manifest.lib);
}
