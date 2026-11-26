// Builds fishc from src with stage 0, the released fishc stage0.toml pins, kept in the cache and
// checked against its digest each time it is used. With no stage 0 cached, the pinned release's
// tarball for this machine is downloaded with curl and checked against its sha256. `--stage0
// <tarball>` takes one from disk instead, and `--stage0 <fishc>` adopts a binary once its digest
// matches. scripts/bootstrap.sh runs this with no fishc at all.
// A new target: stage0.toml has no tarball for a machine no release was packed on. Its first
// stage 0 is cross-compiled on a machine that has one, from the pinned commit's tree at its fixed
// path (`fishc build main.fsh --release --target <triple>`, with `--sysroot` for another system),
// then built twice more on the target, each by the one before, until two builds are the same
// binary. That one is packed as scripts/release.fsh lays a release out and published beside the
// release, and `--stage0 <tarball> --record` writes its sha256 and its fishc's digest into
// stage0.toml for this machine, building nothing.
// `--source <tree>` builds the src of another tree, as a release builds its tagged commit's.
// `--leaks` builds fishc with `--leaks`, for scripts/memsites.fsh to read what it holds.
//   fishc run scripts/build.fsh -- [-o <fishc>] [--stage0 <fishc>|<tarball>] [--record] [--source <tree>] [--leaks]
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { cacheDir, hostKey, pinned, stage0Digest, tarballName, written, type Pinned } from "./stage0.fsh";

// The value after `flag` in the arguments, or undefined.
function option(args: Ref<string[]>, flag: string): string | undefined {
  for (let i: usize = 0; i + 1 < args.length; i++) if (args[i]! === flag) return args[i + 1]!.clone();
  return undefined;
}

// Where the pinned stage 0 is cached: its release unpacked, bin/fishc beside the share/fishc it
// reads.
export function stage0Path(p: Ref<Pinned>): string {
  return join(cacheDir(), "stage0", p.commit, "bin", "fishc");
}

// Why a machine stage0.toml names no tarball for can't build, and what gives it one.
function noStage0(): string {
  return `stage0.toml has no stage 0 for ${hostKey()}, since no release was packed on such a machine; its first one is cross-compiled on a machine that has one, as 'A new target' at the top of scripts/build.fsh says`;
}

// `file` unpacked into the cache as the pinned release, without its top directory.
function untarred(p: Ref<Pinned>, file: string): void throws IoError {
  const dir = join(cacheDir(), "stage0", p.commit);
  mkdirSync(dir, { recursive: true });
  const untar = spawnSync("tar", ["-xzf", file, "-C", dir, "--strip-components=1"]);
  if (untar.status !== 0) fail(`can't unpack ${file}: ${new TextDecoder().decode(untar.stderr).trim()}`);
}

// The pinned release's tarball for this machine, at `tarball` or downloaded, checked against its
// sha256 and unpacked into the cache, then its fishc checked against its digest.
function unpackedRelease(p: Ref<Pinned>, tarball: string | undefined): string throws IoError {
  const release = p.release ?? fail("stage0.toml pins no release to take stage 0 from");
  const want = p.tarballs.get(hostKey()) ?? fail(noStage0());
  let file = tarball ?? join(cacheDir(), "stage0", tarballName(release, hostKey()));
  if (tarball === undefined) {
    mkdirSync(dirname(file), { recursive: true });
    const url = `${p.releases ?? "https://github.com/fishlang-dev/fish/releases/download"}/${release}/${tarballName(release, hostKey())}`;
    console.log(`downloading stage 0, ${url}`);
    const got = spawnSync("curl", ["-fsSL", "-o", file, url]);
    if (got.status !== 0) fail(`can't download ${url}: ${new TextDecoder().decode(got.stderr).trim()}; give it from disk with --stage0 <tarball>`);
  }
  const sum = createHash("sha256").update(readFileSync(file)).digest("hex");
  if (sum !== want) fail(`${file} isn't ${release}'s tarball for ${hostKey()}: its sha256 is ${sum}, and stage0.toml pins ${want}`);
  untarred(p, file);
  if (tarball === undefined) rmSync(file);
  const path = stage0Path(p);
  if (!checked(p, path)) fail(`the fishc in ${release}'s tarball isn't the one stage0.toml pins`);
  console.log(`stage 0 is ${release}, cached at ${path}`);
  return path;
}

// A target's first stage 0, from the tarball it was packed into: unpacked into the cache, with its
// sha256 and its fishc's digest written into stage0.toml for this machine.
function seeded(root: string, tarball: string): string throws IoError | Error {
  let p = pinned(root);
  if (p.release === undefined) fail("stage0.toml pins no release for the tarball to be a target's of");
  const sum = createHash("sha256").update(readFileSync(tarball)).digest("hex");
  untarred(p, tarball);
  const path = stage0Path(p);
  const digest = stage0Digest(path);
  p.tarballs.set(hostKey(), sum);
  p.digests.set(hostKey(), digest);
  writeFileSync(join(root, "stage0.toml"), written(p));
  console.log(`stage0.toml names ${hostKey()}: digest ${digest}, tarball ${sum}`);
  return path;
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

// `binary` copied into the cache as stage 0, once it is checked.
function adopted(p: Ref<Pinned>, binary: string): string throws IoError {
  if (!checked(p, binary)) process.exit(1);
  const path = stage0Path(p);
  mkdirSync(dirname(path), { recursive: true });
  const partial = `${path}.${process.pid}`;
  copyFileSync(binary, partial);
  chmodSync(partial, 0o755);
  renameSync(partial, path);
  console.log(`stage 0 cached at ${path}`);
  return path;
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
// directory that stays: the repository's src, or that of a commit's tree at its fixed path. With
// `leaks`, a
// `--leaks` build, whose fishc reports at exit what it still holds, by allocation site.
export async function compiled(fishc: string, src: string, out: string, leaks = false): Promise<boolean> throws IoError {
  const started = Date.now();
  const flags = leaks ? ["--release", "--leaks"] : ["--release"];
  const code = await ran(`building ${out} from ${src}, about 25 minutes on a fast machine`, [fishc, "build", "main.fsh", ...flags, "-o", out], src);
  if (code !== 0) return false;
  console.log(`built ${out} in ${(Date.now() - started) / 1000}s`);
  return true;
}

// Where stage 0's source tree is: one path on every machine, so the path stage 0 is built at, which
// its binary holds, is the same wherever it is rebuilt, and its digest with it.
export function stage0Tree(p: Ref<Pinned>): string {
  return treeOf(p.commit);
}

export function treeOf(commit: string): string {
  return `/tmp/fish-stage0/${commit}`;
}

// A commit's tree at its fixed path, unpacked when it isn't there, as after a reboot clears /tmp:
// what a fishc built there reads as it builds is there again, with no rebuild.
export function unpacked(commit: string, root: string): string throws IoError {
  const tree = treeOf(commit);
  if (!existsSync(join(tree, "src", "runtime"))) {
    mkdirSync(tree, { recursive: true });
    const r = spawnSync("sh", ["-c", `git -C "${root}" archive ${commit} | tar -x -C "${tree}"`]);
    if (r.status !== 0) fail(`can't unpack ${commit}: ${new TextDecoder().decode(r.stderr)}`);
  }
  return tree;
}

async function main(): Promise<void> throws IoError | Error {
  const args = process.argv.slice(2);
  const root = join(import.meta.dir, "..");
  const out = resolve(option(args, "-o") ?? join(root, "build", "fishc"));
  const given = option(args, "--stage0");
  const tarball = given !== undefined && given!.endsWith(".tar.gz");
  if (args.includes("--record")) {
    if (!tarball) fail("--record writes a target's first stage 0 into stage0.toml from its tarball: --stage0 <tarball> --record");
    console.log(`stage 0 cached at ${seeded(root, resolve(given!))}; nothing is built`);
    return;
  }
  const p = pinned(root);
  let stage0 = stage0Path(p);
  if (tarball) stage0 = unpackedRelease(p, resolve(given!));
  else if (given !== undefined) stage0 = adopted(p, resolve(given!));
  else if (!existsSync(stage0)) stage0 = unpackedRelease(p, undefined);
  else {
    console.log(`checking the cached stage 0, ${stage0}`);
    if (!checked(p, stage0)) fail("the cached stage 0 has changed; adopt a good one with --stage0 <fishc>");
    console.log("stage 0's digest matches stage0.toml");
  }
  // A stage 0 adopted as a bare binary reads its commit's tree at its fixed path as it builds.
  unpacked(p.commit, root);
  mkdirSync(dirname(out), { recursive: true });
  const tree = option(args, "--source");
  const built = await compiled(stage0, join(tree === undefined ? root : resolve(tree!), "src"), out, args.includes("--leaks"));
  if (!built) fail(`stage 0 couldn't build ${out}`);
}
