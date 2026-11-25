// Pins a release as stage 0. The release's tagged commit is built at its fixed path by the stage 0
// pinned now, and that fishc must reach the bootstrap fixpoint and be the very binary the release's
// tarball holds; then stage0.toml names the release, its tarball's sha256 and the binary's digest
// for this machine. Commit the change once the release is published, since a checkout with nothing
// cached downloads it. The release workflow
// runs this on each target's runner and joins the stage0.toml each writes into the one it commits.
// The fishc that runs scripts/build.fsh is FISHC when set, and build/fishc otherwise.
// `--tarball <path>` checks a tarball on disk instead of downloading it, and `--no-fixpoint` leaves
// the fixpoint out, which an hour and a half shorter run is only for trying the script.
//   fishc run scripts/promote.fsh -- <version> [--tarball <path>] [--no-fixpoint]
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { hostKey, pinned, stage0Digest, tarballName, written, type Pinned } from "./stage0.fsh";

const ROOT = resolve(import.meta.dir, "..");
const RELEASES = "https://github.com/fishlang-dev/fish/releases/download";

function fail(message: string): never {
  console.error(`promote: ${message}`);
  return process.exit(1);
}

function option(args: Ref<string[]>, flag: string): string | undefined {
  for (let i: usize = 0; i + 1 < args.length; i++) if (args[i]! === flag) return args[i + 1]!.clone();
  return undefined;
}

function output(command: string, args: string[]): string {
  const line = `${command} ${args.join(" ")}`;
  const result = spawnSync(command, args, { cwd: ROOT, encoding: "utf8" });
  if (result.status !== 0) fail(`'${line}' failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

// Runs `cmd` in `cwd` with its output shown as it goes; whether it succeeded.
async function shown(cmd: string[], cwd: string): Promise<boolean> throws IoError {
  const child = Bun.spawn(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
  const code = await child.exited;
  return code === 0;
}

async function main(): Promise<void> throws IoError | Error {
  const args = process.argv.slice(2);
  const version = args.length > 0 && !args[0]!.startsWith("--") ? args[0]! : fail("usage: fishc run scripts/promote.fsh -- <version> [--tarball <path>] [--no-fixpoint]");
  const tag = `v${version}`;
  const runner = process.env.FISHC ?? "";
  const fishc = runner !== "" ? runner : join(ROOT, "build", "fishc");
  if (!existsSync(fishc)) fail(`no fishc at ${fishc} to run the build with; run scripts/build.fsh first, or set FISHC`);
  const commit = output("git", ["rev-parse", `${tag}^{commit}`]);
  let p: Pinned = pinned(ROOT);
  if (p.commit === commit) fail(`stage 0 is ${tag} already`);

  const tree = `/tmp/fish-stage0/${commit}`;
  if (!existsSync(join(tree, "src", "runtime"))) {
    mkdirSync(tree, { recursive: true });
    output("sh", ["-c", `git archive ${commit} | tar -x -C "${tree}"`]);
  }
  const candidate = join(tree, "candidate");
  console.log(`building ${tag} at ${tree} with the stage 0 pinned now`);
  const built = await shown([fishc, "run", "scripts/build.fsh", "--", "--source", tree, "-o", candidate], ROOT);
  if (!built) fail(`stage 0 couldn't build ${tag}`);
  const digest = stage0Digest(candidate);

  if (args.includes("--no-fixpoint")) console.log("the fixpoint was left out, as --no-fixpoint asked");
  else {
    const reached = await shown([candidate, "run", join(tree, "scripts", "fixpoint.fsh"), "--", "--from", candidate], tree);
    if (!reached) fail(`${tag} doesn't reach the bootstrap fixpoint, so it can't be stage 0`);
  }

  const name = tarballName(tag, hostKey());
  const given = option(args, "--tarball");
  let file = given === undefined ? "" : resolve(given!);
  const scratch = mkdtempSync(join(tmpdir(), "fish-promote-"));
  if (given === undefined) {
    file = join(scratch, name);
    console.log(`downloading ${RELEASES}/${tag}/${name}`);
    output("curl", ["-fsSL", "-o", file, `${RELEASES}/${tag}/${name}`]);
  }
  const sum = createHash("sha256").update(readFileSync(file)).digest("hex");
  output("tar", ["-xzf", file, "-C", scratch, "--strip-components=1"]);
  const shipped = stage0Digest(join(scratch, "bin", "fishc"));
  rmSync(scratch, { recursive: true, force: true });
  if (shipped !== digest) fail(`the fishc in ${name} has digest ${shipped}, but ${tag} built at its fixed path gives ${digest}; the release can't be rebuilt from source, so it can't be stage 0`);

  let next: Pinned = { commit, digests: new Map<string, string>([[hostKey(), digest]]), release: tag, releases: p.releases ?? RELEASES, tarballs: new Map<string, string>([[hostKey(), sum]]) };
  writeFileSync(join(ROOT, "stage0.toml"), written(next));
  console.log(`stage0.toml pins ${tag} for ${hostKey()}: digest ${digest}, tarball ${sum}`);
  if (p.digests.size > 1) console.log("it names this target alone; the release workflow joins each target's with scripts/pins.sh");
  console.log("commit stage0.toml once the release is published");
}
