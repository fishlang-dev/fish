import { listedFiles, readsOf } from "./reads.fsh";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { watch } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import type { Subprocess } from "bun";
import type { Kept } from "./incremental.fsh";

// How long a burst of saves is let settle before rebuilding, and how long a program is given to
// exit on SIGTERM before it is killed.
export const SETTLE_MS = 100;
const GRACE_MS = 2000;

// The files a rebuild depends on: those a build read or looked for, and the package's manifest,
// once each, real paths where they exist. A missing one stays, so its coming back is seen.
/** @throws {IoError} */
export function watchedFiles(loaded: Ref<string[]>, manifest?: string): string[] {
  let files: string[] = [];
  for (const f of loaded) files.push(existsSync(f) ? realpathSync(f) : resolve(f));
  if (manifest !== undefined) {
    files.push(existsSync(manifest) ? realpathSync(manifest) : resolve(manifest));
    // What comptime may read changes the program as a source does.
    const reads = readsOf(manifest);
    if (reads !== undefined) for (const f of listedFiles(reads!)) files.push(f);
  }
  let unique = [...new Set(files)];
  unique.sort();
  return unique;
}

// Each directory to watch, with the names in it that matter. Directories are watched rather than
// files: an editor that saves by renaming a new file into place leaves a file's watch on the old one.
export function directories(files: Ref<string[]>): Map<string, Set<string>> {
  let dirs = new Map<string, Set<string>>();
  for (const f of files) {
    const dir = dirname(f);
    if (dirs.has(dir)) continue;
    let names = new Set<string>();
    for (const g of files) if (dirname(g) === dir) names.add(basename(g));
    dirs.set(dir, names);
  }
  return dirs;
}

/** @throws {IoError} */
export function contentsOf(f: string): string | undefined {
  return existsSync(f) ? readFileSync(f, "utf8") : undefined;
}

// Each file's contents, missing ones as undefined, so a restart follows a change to what a build
// would read rather than any event: editors touch files, and macOS reports one save more than once.
/** @throws {IoError} */
export function snapshot(files: Ref<string[]>): Map<string, string | undefined> {
  let contents = new Map<string, string | undefined>();
  for (const f of files) contents.set(f, contentsOf(f));
  return contents;
}

// The first file whose contents differ from those in `before`.
/** @throws {IoError} */
export function changed(before: Ref<Map<string, string | undefined>>): string | undefined {
  for (const [f, text] of before) if (contentsOf(f) !== text) return f;
  return undefined;
}

async function exitOf(child: Ref<Subprocess>): Promise<boolean> {
  await child.exited;
  return true;
}

async function late(ms: i64): Promise<boolean> {
  await Bun.sleep(ms);
  return false;
}

// Stops `child` with SIGTERM, killing it if it hasn't exited within `grace` milliseconds.
export async function stop(child: Ref<Subprocess>, grace: i64 = GRACE_MS): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([exitOf(child), late(grace)]);
  if (exited) return;
  child.kill("SIGKILL");
  await child.exited;
}

// `build` builds the program into `binary`, printing its warnings or error as `fishc run` does,
// and gives whether it built and the files it read. `done` runs once before exiting.
// One build: whether it built, the files it read or looked for, and what it keeps for the next.
export type Rebuilt = { built: boolean; loaded: string[]; kept: Kept | undefined };
export type Watching = { entry: string; binary: string; args: string[]; manifest?: string; build: (kept: Kept | undefined) => Rebuilt; done: () => void };

// Each signal the watcher was sent, a second of the same kind apart from the first. Controllers
// rather than counters, since a listener owns what it captures and can't change it.
export type Signals = { interrupt: AbortSignal; interruptAgain: AbortSignal; terminate: AbortSignal; terminateAgain: AbortSignal };

export function received(s: Ref<Signals>): i64 {
  let n = 0;
  if (s.interrupt.aborted) n++;
  if (s.interruptAgain.aborted) n++;
  if (s.terminate.aborted) n++;
  if (s.terminateAgain.aborted) n++;
  return n;
}

export function shown(f: string): string {
  const r = relative(process.cwd(), f);
  return r === "" ? f : r;
}

// What ends one wait of the watcher's loop.
export type Event = { kind: "change" } | { kind: "settled" } | { kind: "exited"; code: i64 } | { kind: "signal" } | { kind: "stopped" };

// Until `count` signals have arrived, or `round` ends this wait, which also stands in for a source
// with nothing to wait for.
// ponytail: polled every 10 ms, as process.on's handler only counts; await the signal itself once
// std can
export async function signalled(s: Ref<Signals>, count: i64, round: Ref<AbortSignal>): Promise<Event> {
  while (received(s) < count && !round.aborted) await Bun.sleep(10);
  return { kind: "signal" };
}

export async function settled(due: i64 | undefined, s: Ref<Signals>, round: Ref<AbortSignal>): Promise<Event> {
  if (due === undefined) return await signalled(s, 1, round);
  await Bun.sleep(Math.max(0, due - Date.now()));
  return { kind: "settled" };
}

export async function exited(child: Ref<Subprocess | undefined>, s: Ref<Signals>, round: Ref<AbortSignal>): Promise<Event> {
  if (child === undefined) return await signalled(s, 1, round);
  const code = await child.exited;
  return { kind: "exited", code };
}

export async function stopped(child: Ref<Subprocess>): Promise<Event> {
  await stop(child);
  return { kind: "stopped" };
}

// A change to one of `names` in `dir`, until `signal`. A watch that fails counts as a change,
// leaving the settle's comparison of contents to decide.
async function changeIn(dir: string, names: string[], signal: AbortSignal): Promise<Event> {
  try {
    for await (const e of watch(dir, { signal })) {
      const name = e.filename;
      if (name === null || names.includes(basename(name))) return { kind: "change" };
    }
  } catch (_e) {}
  return { kind: "change" };
}

// A change to any of `files`. A directory that doesn't exist can't be watched; a later build
// watches it once it does.
export async function changes(files: Ref<string[]>, s: Ref<Signals>, round: Ref<AbortController>): Promise<Event> {
  let waits: Promise<Event>[] = [];
  for (const [dir, names] of directories(files)) if (existsSync(dir)) waits.push(changeIn(dir, [...names], round.signal));
  const ending = round.signal;
  if (waits.length === 0) return await signalled(s, 1, ending);
  return await Promise.race(waits);
}

type Started = { files: string[]; contents: Map<string, string | undefined>; child: Subprocess | undefined; kept: Kept | undefined };

// Builds and starts the program, giving the files to watch from now on and their contents.
/** @throws {IoError} */
async function start(w: Ref<Watching>, files: string[], note: (text: string) => void, kept: Kept | undefined): Promise<Started> {
  // Read before building, so a save during the build still differs afterwards.
  const before = snapshot(files);
  let result = w.build(kept);
  // A build that failed may not have reached every import, so the files watched only grow then.
  let wanted: string[] = result.built ? [] : files;
  for (const f of result.loaded) wanted.push(f);
  wanted.push(w.entry);
  const watched = watchedFiles(wanted, w.manifest);
  let contents = new Map<string, string | undefined>();
  for (const f of watched) contents.set(f, before.has(f) ? before.get(f) : contentsOf(f));
  if (!result.built) {
    note("waiting for changes");
    return { files: watched, contents, child: undefined, kept: result.kept };
  }
  const child = Bun.spawn([w.binary, ...w.args], { stdio: ["inherit", "inherit", "inherit"] });
  return { files: watched, contents, child, kept: result.kept };
}

// A program already sent SIGTERM is killed, as is every program on a second signal, so none
// outlives the watcher.
async function quit(w: Ref<Watching>, s: Ref<Signals>, child: Ref<Subprocess | undefined>, stopping: boolean): Promise<void> {
  const code: i64 = s.interrupt.aborted ? 130 : 143;
  if (child !== undefined) {
    if (stopping) child.kill("SIGKILL");
    const round = new AbortController();
    const ending = round.signal;
    const ended = await Promise.race([stopped(child), signalled(s, 2, ending)]);
    round.abort();
    if (ended.kind === "signal") {
      child.kill("SIGKILL");
      await child.exited;
    }
  }
  w.done();
  process.exit(code);
}

// The SIGINT and SIGTERM the watcher is sent from now on.
export function listening(): Signals {
  const interrupt = new AbortController();
  const interruptAgain = new AbortController();
  const terminate = new AbortController();
  const terminateAgain = new AbortController();
  const s: Signals = { interrupt: interrupt.signal, interruptAgain: interruptAgain.signal, terminate: terminate.signal, terminateAgain: terminateAgain.signal };
  process.on("SIGINT", () => {
    if (interrupt.signal.aborted) interruptAgain.abort();
    interrupt.abort();
  });
  process.on("SIGTERM", () => {
    if (terminate.signal.aborted) terminateAgain.abort();
    terminate.abort();
  });
  return s;
}

// Every file whose contents differ from those in `before`.
/** @throws {IoError} */
export function allChanged(before: Ref<Map<string, string | undefined>>): string[] {
  let found: string[] = [];
  for (const [f, text] of before) if (contentsOf(f) !== text) found.push(f);
  return found;
}

// The files of `before` that change next, once a burst of saves has settled, or undefined when a
// signal arrives first.
// ponytail: one settle per burst, so saves spread over more than SETTLE_MS can make two runs
/** @throws {IoError} */
export async function nextChanges(before: Ref<Map<string, string | undefined>>, s: Ref<Signals>): Promise<string[] | undefined> {
  let files: string[] = [];
  for (const f of before.keys()) files.push(f);
  while (received(s) === 0) {
    if (changed(before) !== undefined) {
      await Bun.sleep(SETTLE_MS);
      const found = allChanged(before);
      if (found.length > 0) return found;
    }
    const round = new AbortController();
    const ending = round.signal;
    const event = await Promise.race([changes(files, s, round), signalled(s, 1, ending)]);
    round.abort();
    if (event.kind === "signal") return undefined;
  }
  return undefined;
}

// Builds and runs the program, then rebuilds and restarts it each time a file it was built from
// changes, until SIGINT or SIGTERM.
/** @throws {IoError} */
export async function watchProgram(w: Watching): Promise<never> {
  const s = listening();
  const note = (text: string) => console.error(`[fishc] ${text}`);
  let first = await start(w, watchedFiles([w.entry], w.manifest), note, undefined);
  let files = first.files;
  let contents = first.contents;
  let child = first.child;
  // What the last build kept, which the next starts from.
  let kept = first.kept;
  let due: i64 | undefined = undefined;
  while (true) {
    // Fish drops the waits that lose a race, so each round watches afresh, and nothing is watched
    // while a program stops or builds; a save made meanwhile is found here.
    if (due === undefined && changed(contents) !== undefined) due = Date.now() + SETTLE_MS;
    const round = new AbortController();
    const ending = round.signal;
    const event = await Promise.race([changes(files, s, round), settled(due, s, ending), exited(child, s, ending), signalled(s, 1, ending)]);
    round.abort();
    if (event.kind === "signal") await quit(w, s, child, false);
    if (event.kind === "change") due = Date.now() + SETTLE_MS;
    if (event.kind === "exited") {
      note(`${shown(w.entry)} exited with code ${event.code}; waiting for changes`);
      child = undefined;
    }
    if (event.kind !== "settled") continue;
    due = undefined;
    const file = changed(contents);
    if (file === undefined) continue;
    note(`restarting: ${shown(file)} changed`);
    let interrupted = false;
    if (child !== undefined) {
      const stopping = new AbortController();
      const ending = stopping.signal;
      const ended = await Promise.race([stopped(child), signalled(s, 1, ending)]);
      stopping.abort();
      interrupted = ended.kind === "signal";
    }
    if (interrupted) await quit(w, s, child, true);
    let next = await start(w, files, note, kept);
    files = next.files;
    contents = next.contents;
    child = next.child;
    kept = next.kept;
  }
}
