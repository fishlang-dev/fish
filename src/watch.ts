import { existsSync, readFileSync, realpathSync, watch, type FSWatcher } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import type { Subprocess } from "bun";

// How long a burst of saves is let settle before rebuilding, and how long a program is given to
// exit on SIGTERM before it is killed.
const SETTLE_MS = 100;
const GRACE_MS = 2000;

// The files a rebuild depends on: those a build read or looked for, and the package's manifest,
// once each, real paths where they exist. A missing one stays, so its coming back is seen.
export function watchedFiles(loaded: string[], manifest?: string): string[] {
  const files = [...loaded, ...(manifest ? [manifest] : [])].map((f) => (existsSync(f) ? realpathSync(f) : resolve(f)));
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

// `build` builds the program into `binary`, printing its warnings or error as `fishc run` does,
// gives whether it built, and tells `loaded` the files it read. `done` runs once before exiting.
export type Watching = { entry: string; binary: string; args: string[]; manifest?: string; build: (loaded: (files: string[]) => void) => boolean; done: () => void };

// Builds and runs the program, then rebuilds and restarts it each time a file it was built from
// changes, until SIGINT or SIGTERM.
export function watchProgram(w: Watching): Promise<never> {
  const state = {
    files: watchedFiles([w.entry], w.manifest),
    contents: new Map<string, string | undefined>(),
    watchers: [] as FSWatcher[],
    child: undefined as Subprocess | undefined,
    // Programs sent SIGTERM for a restart, still within their grace period.
    stopping: new Set<Subprocess>(),
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    busy: false,
    again: false,
    quitting: false,
  };
  const note = (text: string) => console.error(`[fishc] ${text}`);
  const shown = (f: string) => relative(process.cwd(), f) || f;
  const schedule = () => {
    clearTimeout(state.timer);
    state.timer = setTimeout(cycle, SETTLE_MS);
  };
  const rewatch = () => {
    for (const watcher of state.watchers) watcher.close();
    // A directory that doesn't exist can't be watched; a later build watches it once it does.
    state.watchers = [...directories(state.files)].filter(([dir]) => existsSync(dir)).map(([dir, names]) => watch(dir, (_, name) => {
      if (name === null || names.has(basename(name))) schedule();
    }));
  };
  const start = () => {
    // Read before building, so a save during the build still differs afterwards.
    const before = snapshot(state.files);
    let loaded: string[] = [];
    const built = w.build((files) => (loaded = files));
    // A build that failed may not have reached every import, so the files watched only grow then.
    state.files = watchedFiles([...(built ? [] : state.files), ...loaded, w.entry], w.manifest);
    state.contents = new Map(state.files.map((f) => [f, before.has(f) ? before.get(f) : snapshot([f]).get(f)]));
    rewatch();
    if (!built) return note("waiting for changes");
    const child = Bun.spawn([w.binary, ...w.args], { stdio: ["inherit", "inherit", "inherit"] });
    state.child = child;
    void child.exited.then((code) => {
      if (state.child === child && !state.quitting) note(`${shown(w.entry)} exited with code ${code}; waiting for changes`);
    });
  };
  const cycle = async () => {
    if (state.busy) return void (state.again = true);
    state.busy = true;
    do {
      state.again = false;
      const file = changed(state.contents);
      if (file === undefined) continue;
      note(`restarting: ${shown(file)} changed`);
      const child = state.child;
      state.child = undefined;
      if (child) {
        state.stopping.add(child);
        await stop(child);
        state.stopping.delete(child);
      }
      if (state.quitting) return;
      start();
    } while (state.again);
    state.busy = false;
  };
  // A program already sent SIGTERM is killed, as is every program on a second signal, so none
  // outlives the watcher.
  const quit = (code: number) => async () => {
    const child = state.child;
    for (const c of state.quitting ? [...state.stopping, ...(child ? [child] : [])] : state.stopping) c.kill("SIGKILL");
    if (state.quitting) return;
    state.quitting = true;
    for (const watcher of state.watchers) watcher.close();
    clearTimeout(state.timer);
    await Promise.all([...state.stopping].map((c) => c.exited));
    if (child) await stop(child);
    w.done();
    process.exit(code);
  };
  process.on("SIGINT", quit(130));
  process.on("SIGTERM", quit(143));
  start();
  return new Promise(() => {});
}
