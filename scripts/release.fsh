// Cuts a release: fish.toml's version bumped, a CHANGELOG.md section from the conventional commits
// since the last tag, a release commit and an annotated `v<version>` tag. Nothing is pushed. The
// release workflow runs this on a runner, on main, once a release branch's pull request into it is
// merged, then pushes, packs, publishes and promotes, so every release tarball is built on CI.
// `--nightly` builds and packs a tarball of HEAD named for today's date, with no commit or tag,
// and `--pack <version>` packs the tarball of a release already tagged, under dist/ with its sha256.
// The tarball's fishc is built from the commit's own tree at /tmp/fish-stage0/<commit>, the fixed
// path stage 0 is built at, since a fishc holds the path it was built at: any machine building the
// commit there gets the same binary, which is what lets a release be pinned as stage 0.
//   fishc run scripts/release.fsh -- <version> | --nightly | --pack <version>
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { hostKey } from "./stage0.fsh";

const ROOT = resolve(import.meta.dir, "..");

function fail(message: string): never {
  console.error(`release: ${message}`);
  return process.exit(1);
}

// What `command` printed, or a failure naming it.
function run(command: string, args: string[]): string {
  const line = `${command} ${args.join(" ")}`;
  const result = spawnSync(command, args, { cwd: ROOT, encoding: "utf8" });
  if (result.status !== 0) fail(`'${line}' failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

// Runs `cmd` with its output shown as it goes, as a build's is.
async function shown(cmd: string[]): Promise<void> throws IoError {
  const line = cmd.join(" ");
  const child = Bun.spawn(cmd, { cwd: ROOT, stdout: "inherit", stderr: "inherit" });
  const code = await child.exited;
  if (code !== 0) fail(`'${line}' failed`);
}

// The newest tag reachable from HEAD, or undefined before the first release.
function lastTag(): string | undefined {
  const result = spawnSync("git", ["describe", "--tags", "--abbrev=0", "--match", "v*"], { cwd: ROOT, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

// A commit subject without its `feat:` or `fix(x):` prefix, starting with a capital.
function described(subject: string): string {
  const text = subject.replace(/^[a-z]+(\([^)]*\))?!?:\s*/, "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// The changelog section for `version`: what the commits since `since` added, fixed and sped up.
// Refactors, tests, chores and docs are left out, as they change nothing a user sees.
function section(version: string, since: string | undefined, date: string): string {
  let out = `## ${version} - ${date}\n\n`;
  if (since === undefined) return out + "The first release.\n";
  const log = run("git", ["log", "--no-merges", "--format=%s", `${since}..HEAD`]);
  const groups: [string, string][] = [["feat", "Added"], ["fix", "Fixed"], ["perf", "Faster"]];
  let any = false;
  for (const [kind, title] of groups) {
    let lines: string[] = [];
    for (const subject of log.split("\n")) if (ofKind(subject, kind)) lines.push(`- ${described(subject)}`);
    if (lines.length === 0) continue;
    any = true;
    out += `### ${title}\n\n${lines.join("\n")}\n\n`;
  }
  return any ? out.trimEnd() + "\n" : out + "Nothing a user would notice changed.\n";
}

// Whether a commit subject is of `kind`, as `feat: x`, `feat(lsp): x` or `feat!: x` are of `feat`.
function ofKind(subject: string, kind: string): boolean {
  return subject.startsWith(kind) && /^(\([^)]*\))?!?:/.test(subject.slice(kind.length as i64));
}

// CHANGELOG.md with `added` as its newest section.
function changelog(added: string): string throws IoError {
  const path = join(ROOT, "CHANGELOG.md");
  const header = "# Changelog\n\nEach release's changes, newest first, from its conventional commits.\n";
  const old = existsSync(path) ? readFileSync(path, "utf8") : header;
  const body = old.startsWith(header) ? old.slice(header.length as i64) : `\n${old}`;
  return `${header}\n${added}${body}`;
}

// fish.toml with its package version set to `version`.
function bumped(version: string): string throws IoError {
  const text = readFileSync(join(ROOT, "fish.toml"), "utf8");
  if (!/^version = "[^"]*"$/m.test(text)) fail("fish.toml has no version line to bump");
  return text.replace(/^version = "[^"]*"$/m, `version = "${version}"`);
}

// Builds fishc from this checkout and packs it with the sources it reads as it runs, as
// `bin/fishc` and `share/fishc/`, into dist/<name>.tar.gz beside its sha256.
async function pack(name: string, commit: string): Promise<string> throws IoError {
  const tree = `/tmp/fish-stage0/${commit}`;
  if (!existsSync(join(tree, "src", "runtime"))) {
    mkdirSync(tree, { recursive: true });
    run("sh", ["-c", `git archive ${commit} | tar -x -C "${tree}"`]);
  }
  const dist = join(ROOT, "dist");
  const stage = join(dist, name);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(join(stage, "bin"), { recursive: true });
  await shown(["build/fishc", "run", "scripts/build.fsh", "--", "-o", join(stage, "bin", "fishc"), "--source", tree]);
  const share = join(stage, "share", "fishc");
  mkdirSync(join(share, "src"), { recursive: true });
  run("cp", ["-R", join(tree, "vendor"), join(share, "vendor")]);
  run("cp", ["-R", join(tree, "src", "runtime"), join(share, "src", "runtime")]);
  run("cp", [join(tree, "LICENSE-MIT"), join(tree, "LICENSE-APACHE"), stage]);
  const tarball = join(dist, `${name}.tar.gz`);
  run("tar", ["-czf", tarball, "-C", dist, name]);
  rmSync(stage, { recursive: true, force: true });
  const sum = createHash("sha256").update(readFileSync(tarball)).digest("hex");
  writeFileSync(`${tarball}.sha256`, `${sum}  ${name}.tar.gz\n`);
  console.log(`packed ${tarball}\nsha256 ${sum}`);
  return tarball;
}

async function main(): Promise<void> throws IoError {
  const args = process.argv.slice(2);
  if (!existsSync(join(ROOT, "build", "fishc"))) fail("no build/fishc to build the release with; run scripts/build.fsh first");
  const date = new Date().toISOString().slice(0, 10);
  if (args.length === 1 && args[0]! === "--nightly") {
    await pack(`fishc-nightly-${date}-${hostKey()}`, run("git", ["rev-parse", "HEAD"]));
    return;
  }
  if (args.length === 2 && args[0]! === "--pack") {
    const tagged = run("git", ["rev-parse", `v${args[1]!}^{commit}`]);
    await pack(`fishc-${args[1]!}-${hostKey()}`, tagged);
    return;
  }
  if (args.length !== 1 || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(args[0]!)) fail("usage: fishc run scripts/release.fsh -- <major.minor.patch> | --nightly | --pack <version>");
  const version = args[0]!;
  const tag = `v${version}`;
  if (run("git", ["status", "--porcelain"]) !== "") fail("the working tree has changes; commit or stash them first");
  if (spawnSync("git", ["rev-parse", "-q", "--verify", `refs/tags/${tag}`], { cwd: ROOT }).status === 0) fail(`${tag} is already tagged`);
  writeFileSync(join(ROOT, "fish.toml"), bumped(version));
  writeFileSync(join(ROOT, "CHANGELOG.md"), changelog(section(version, lastTag(), date)));
  run("git", ["add", "fish.toml", "CHANGELOG.md"]);
  run("git", ["commit", "-q", "-m", `chore: release ${version}`]);
  run("git", ["tag", "-a", tag, "-m", `fishc ${version}`]);
  console.log(`committed and tagged ${tag}; nothing was pushed`);
}
