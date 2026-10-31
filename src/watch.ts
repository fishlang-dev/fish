import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import type { Subprocess } from "bun";

// How long a program is given to exit on SIGTERM before it is killed.
const GRACE_MS = 2000;

// The files a rebuild depends on: those a build loaded, and the package's manifest, as real paths.
export function watchedFiles(loaded: string[], manifest?: string): string[] {
  const files = [...loaded, ...(manifest ? [manifest] : [])].filter((f) => existsSync(f)).map((f) => realpathSync(resolve(f)));
  return [...new Set(files)].sort();
}

// Each directory to watch, with the names in it that matter. Directories are watched rather than
// files: an editor that saves by renaming a new file into place leaves a file's watch on the old one.
export function directories(files: string[]): Map<string, Set<string>> {
  const dirs = new Map<string, Set<string>>();
  for (const f of files) {
    const names = dirs.get(dirname(f)) ?? new Set();
    names.add(basename(f));
    dirs.set(dirname(f), names);
  }
  return dirs;
}

// Each file's contents, missing ones as undefined, so a restart follows a change to what a build
// would read rather than any event: editors touch files, and macOS reports one save more than once.
export function snapshot(files: string[]): Map<string, string | undefined> {
  return new Map(files.map((f) => [f, existsSync(f) ? readFileSync(f, "utf8") : undefined]));
}

// The first file whose contents differ from those in `before`.
export function changed(before: Map<string, string | undefined>): string | undefined {
  return [...before].find(([f, text]) => (existsSync(f) ? readFileSync(f, "utf8") : undefined) !== text)?.[0];
}

// Stops `child` with SIGTERM, killing it if it hasn't exited within `grace` milliseconds.
export async function stop(child: Subprocess, grace: number = GRACE_MS): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), grace);
  await child.exited;
  clearTimeout(timer);
}
