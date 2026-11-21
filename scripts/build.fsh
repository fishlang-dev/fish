// Builds fishc from src with stage 0, the fishc stage0.toml pins, kept in the cache and checked
// against its digest each time it is used. `--stage0 <fishc>` adopts a binary into the cache once
// its digest matches; with no stage 0 cached, it is built from the pinned commit, which needs git
// and, this once, Bun. scripts/bootstrap.sh runs this with no fishc at all.
// `--record` rebuilds stage 0 and writes its digest for this machine into stage0.toml.
//   fishc run scripts/build.fsh -- [-o <fishc>] [--stage0 <fishc>] [--record]
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { hostKey, pinned, stage0Digest, type Pinned } from "./stage0.fsh";

// The value after `flag` in the arguments, or undefined.
function option(args: Ref<string[]>, flag: string): string | undefined {
  for (let i: usize = 0; i + 1 < args.length; i++) if (args[i]! === flag) return args[i + 1]!.clone();
  return undefined;
}

// Where fishc keeps what it caches, as the compiler's own cacheDir finds it.
function cacheDir(): string {
  const given = process.env.FISH_CACHE_DIR ?? "";
  if (given !== "") return given;
  const xdg = process.env.XDG_CACHE_HOME ?? "";
  const home = homedir();
  return join(xdg !== "" ? xdg : home !== "" ? join(home, ".cache") : tmpdir(), "fish");
}

// Where the pinned stage 0 is cached.
export function stage0Path(p: Ref<Pinned>): string {
  return join(cacheDir(), "stage0", p.commit, "fishc");
}

function fail(message: string): never {
  console.error(`build: ${message}`);
  return process.exit(1);
}

// Whether `binary` is the pinned stage 0 for this machine, saying why not when it isn't.
function checked(p: Ref<Pinned>, binary: string): boolean throws IoError {
  const want = p.digests.get(hostKey());
  if (want === undefined) fail(`stage0.toml has no digest for ${hostKey()}; this machine's stage 0 can't be checked`);
  const got = stage0Digest(binary);
  if (got === want!) return true;
  console.error(`build: ${binary} isn't stage 0 for ${hostKey()}: its digest is ${got}, and stage0.toml pins ${want!}`);
  return false;
}

// `binary` copied into the cache as stage 0, once it is checked, unless its digest was just recorded.
function adopted(p: Ref<Pinned>, binary: string, record: boolean): string throws IoError {
  if (!record && !checked(p, binary)) process.exit(1);
  const path = stage0Path(p);
  mkdirSync(dirname(path), { recursive: true });
  const partial = `${path}.${process.pid}`;
  copyFileSync(binary, partial);
  chmodSync(partial, 0o755);
  renameSync(partial, path);
  console.log(`stage 0 cached at ${path}`);
  return path;
}

function linked(target: string, path: string): void throws IoError {
  if (lstatSync(path, { throwIfNoEntry: false }) === undefined) symlinkSync(target, path);
}

// The pinned commit's source as Fish in `to`, its src being TypeScript: each src/*.ts, or its .fsh
// twin, with its `.ts` imports renamed `.fsh`, the runtime's C sources inside it and vendor beside it.
export function mirror(root: string, to: string): usize throws IoError {
  const src = join(root, "src");
  mkdirSync(to, { recursive: true });
  let n: usize = 0;
  for (const f of readdirSync(src)) {
    if (!f.endsWith(".ts") || f.endsWith(".d.ts")) continue;
    const twin = join(src, f.slice(0, (f.length as i64) - 3) + ".fsh");
    const text = readFileSync(existsSync(twin) ? twin : join(src, f), "utf8");
    writeFileSync(join(to, f.slice(0, (f.length as i64) - 3) + ".fsh"), text.replace(/(["'])(\.{1,2}\/[^"']+)\.ts\1/g, "$1$2.fsh$1"));
    n++;
  }
  linked(join(src, "runtime"), join(to, "runtime"));
  linked(join(root, "vendor"), join(dirname(to), "vendor"));
  return n;
}

async function exitOf(exited: Promise<i64>): Promise<i64> {
  return await exited;
}

const STILL = -1000;

async function aMinute(): Promise<i64> {
  await sleep(60000);
  return STILL;
}

// `cmd` run in `cwd` with its output shown as it comes, saying once a minute how long it has run,
// since a build of fishc says nothing of its own for tens of minutes. Its exit code.
async function ran(label: string, cmd: string[], cwd: string): Promise<i64> throws IoError {
  console.log(label);
  const started = Date.now();
  const child = Bun.spawn(cmd, { cwd: cwd, stdout: "inherit", stderr: "inherit" });
  while (true) {
    const code = await Promise.race([exitOf(child.exited), aMinute()]);
    if (code !== STILL) return code;
    console.log(`  still running, ${(Date.now() - started) / 60000} min`);
  }
}

// fishc built by `fishc` from the source in `src` into `out`, as a release build. A fishc finds
// vendor and the runtime's sources from where its source was when it was built, so `src` is a
// directory that stays: the repository's src, or the mirror in stage 0's own tree.
export async function compiled(fishc: string, src: string, out: string): Promise<boolean> throws IoError {
  const started = Date.now();
  const code = await ran(`building ${out} from ${src}, about 25 minutes on a fast machine`, [fishc, "build", "main.fsh", "--release", "-o", out], src);
  if (code !== 0) return false;
  console.log(`built ${out} in ${(Date.now() - started) / 1000}s`);
  return true;
}

// Where stage 0's source tree is: one path on every machine, so the path stage 0 is built at, which
// its binary holds, is the same wherever it is rebuilt, and its digest with it.
export function stage0Tree(p: Ref<Pinned>): string {
  return `/tmp/fish-stage0/${p.commit}`;
}

// Stage 0's tree, unpacked from the pinned commit when it isn't there, as after a reboot clears
// /tmp: what stage 0 reads as it builds is there again, with no rebuild.
function prepared(p: Ref<Pinned>, root: string): string throws IoError {
  const tree = stage0Tree(p);
  if (!existsSync(join(tree, "src", "runtime"))) {
    mkdirSync(tree, { recursive: true });
    const r = spawnSync("sh", ["-c", `git -C "${root}" archive ${p.commit} | tar -x -C "${tree}"`]);
    if (r.status !== 0) fail(`can't unpack ${p.commit}: ${new TextDecoder().decode(r.stderr)}`);
  }
  mkdirSync(join(tree, "build", "src"), { recursive: true });
  linked(join(tree, "src", "runtime"), join(tree, "build", "src", "runtime"));
  linked(join(tree, "vendor"), join(tree, "build", "vendor"));
  return tree;
}

async function step(label: string, command: string, cwd: string): Promise<void> throws IoError {
  const code = await ran(`stage 0: ${label}`, ["sh", "-c", command], cwd);
  if (code !== 0) fail(`stage 0: couldn't ${label}`);
}

// Stage 0 built from the pinned commit in its tree: the commit's own compiler, run by Bun, builds a
// first fishc from its source, and that one builds the source again, as the fixpoint's second
// generation is built; only the second is the binary the digest pins. Checked against the digest,
// or with `record`, its digest written into stage0.toml for this machine's target.
async function rebuilt(p: Ref<Pinned>, root: string, record: boolean): Promise<string> throws IoError {
  console.log(`stage 0 isn't cached; building it from ${p.commit}, about an hour, once`);
  const tree = prepared(p, root);
  await step("mirror its source", "bun src/main.ts run scripts/mirror.fsh", tree);
  await step("build a first fishc with Bun", `bun src/main.ts build tests/compiler/main.fsh --release -o "${join(tree, "first")}"`, tree);
  console.log("stage 0: build it again with that fishc");
  const at = join(tree, "build", "src");
  for (const f of readdirSync(at)) if (f.endsWith(".fsh")) rmSync(join(at, f));
  mirror(tree, at);
  const second = await compiled(join(tree, "first"), at, join(tree, "second"));
  if (!second) fail("stage 0: the first fishc couldn't build the commit's source");
  if (record) recorded(root, stage0Digest(join(tree, "second")));
  return adopted(p, join(tree, "second"), record);
}

// stage0.toml with this machine's target's digest set to `digest`.
function recorded(root: string, digest: string): void throws IoError {
  const path = join(root, "stage0.toml");
  const line = `"${hostKey()}" = "${digest}"`;
  let lines = readFileSync(path, "utf8").split("\n");
  const at = lines.findIndex((l) => l.startsWith(`"${hostKey()}" =`));
  if (at >= 0) lines[at as usize] = line;
  else lines.splice(lines.findIndex((l) => l === "[digests]") + 1, 0, line);
  writeFileSync(path, lines.join("\n"));
  console.log(`stage0.toml: ${line}`);
}

async function main(): Promise<void> throws IoError | Error {
  const args = process.argv.slice(2);
  const root = join(import.meta.dir, "..");
  const record = args.includes("--record");
  let p = pinned(root);
  const out = resolve(option(args, "-o") ?? join(root, "build", "fishc"));
  const given = option(args, "--stage0");
  let stage0 = stage0Path(p);
  if (record) {
    stage0 = await rebuilt(p, root, true);
    p = pinned(root);
  } else if (given !== undefined) stage0 = adopted(p, resolve(given!), false);
  else if (!existsSync(stage0)) stage0 = await rebuilt(p, root, false);
  else {
    console.log(`checking the cached stage 0, ${stage0}`);
    if (!checked(p, stage0)) fail("the cached stage 0 has changed; adopt a good one with --stage0 <fishc>");
    console.log("stage 0's digest matches stage0.toml");
  }
  prepared(p, root);
  mkdirSync(dirname(out), { recursive: true });
  const built = await compiled(stage0, join(root, "src"), out);
  if (!built) fail(`stage 0 couldn't build ${out}`);
}
