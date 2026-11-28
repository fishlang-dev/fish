// `fishc daemon`: a process holding what its last build kept, on a Unix socket in the cache
// directory, so `fishc build` and `fishc check` after an edit take `fishc watch`'s incremental path
// instead of loading and checking the whole program again. A client writes one request as a JSON
// line; the daemon answers with one JSON reply and closes the connection.
import { existsSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { compilerDigest } from "./checkcache.fsh";
import type { Kept } from "./incremental.fsh";
import { cacheDir } from "./mathlib.fsh";

// A build or check handed over: `fishc` is the client's `compilerDigest`, so a daemon built from
// other source refuses it, and `colour` whether the client's stderr takes painted errors.
export type DaemonRequest = { fishc: string; cwd: string; command: string; file: string; out: string; release: boolean; panic: string; links: string[]; debug: boolean; leaks: boolean; locked: boolean; colour: boolean };

// What the client prints and exits with, or `stale` when it should build itself.
export type DaemonReply = { code: i64; stderr: string; stale: boolean };

// One request served, and what to keep for the next.
export type Served = { reply: DaemonReply; kept: Kept | undefined };

export function daemonSocket(): string {
  return join(cacheDir(), "daemon.sock");
}

// What a kept build depends on beyond its files: another program or other options start afresh.
/** @throws {IoError} */
function slotKey(r: Ref<DaemonRequest>): string {
  const entry = resolve(r.cwd, r.file);
  const real = existsSync(entry) ? realpathSync(entry) : entry;
  return `${real}\n${r.release}\n${r.panic}\n${r.leaks}\n${r.debug}`;
}

// Reads up to the first newline, or to the end when there is none.
/** @throws {IoError} */
async function lineFrom(conn: Ref<UnixStream>): Promise<string> {
  let bytes: u8[] = [];
  while (true) {
    const got = await conn.read(65536);
    if (got.length === 0) break;
    let ended = false;
    for (const b of got) {
      if (b === 10) {
        ended = true;
        break;
      }
      bytes.push(b);
    }
    if (ended) break;
  }
  return new TextDecoder().decode(bytes);
}

/** @throws {IoError} */
async function untilEnd(conn: Ref<UnixStream>): Promise<string> {
  let bytes: u8[] = [];
  while (true) {
    const got = await conn.read(65536);
    if (got.length === 0) break;
    for (const b of got) bytes.push(b);
  }
  return new TextDecoder().decode(bytes);
}

// The daemon's answer to `request`, or undefined when there is none to ask or it didn't answer, as
// when it died building: the caller then builds itself.
export async function viaDaemon(request: Ref<DaemonRequest>): Promise<DaemonReply | undefined> {
  try {
    const conn = await UnixStream.connect(daemonSocket());
    await conn.write(new TextEncoder().encode(JSON.stringify(request) + "\n"));
    const text = await untilEnd(conn);
    if (text === "") return undefined;
    const reply = JSON.parse<DaemonReply>(text);
    return reply.stale ? undefined : reply;
  } catch (_e) {
    return undefined;
  }
}

function removed(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch (_e) {
    // A socket file left behind is removed by the next daemon, which finds nothing listening on it.
  }
}

// Serves builds one at a time until SIGINT or SIGTERM, `build` doing each from what the last kept.
/** @throws {IoError} */
export async function serveDaemon(build: (r: Ref<DaemonRequest>, kept: Kept | undefined) => Served): Promise<never> {
  const path = daemonSocket();
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) {
    let answered = false;
    try {
      const _other = await UnixStream.connect(path);
      answered = true;
    } catch (_e) {
      // Nothing listens: the socket was left by a daemon that died.
      rmSync(path, { force: true });
    }
    if (answered) {
      console.error(`fishc daemon: one is already running on ${path}`);
      process.exit(1);
    }
  }
  let bound: UnixListener | undefined = undefined;
  try {
    bound = await UnixListener.bind(path);
  } catch (e) {
    console.error(`fishc daemon: can't listen on ${path}: ${e.message}; set FISH_CACHE_DIR to a directory with a shorter path`);
    process.exit(1);
  }
  const listener = bound!;
  const socket = `${path}`;
  process.on("SIGINT", () => {
    removed(socket);
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    removed(socket);
    process.exit(143);
  });
  const digest = compilerDigest();
  console.error(`[fishc] daemon listening on ${path}`);
  let key = "";
  let kept: Kept | undefined = undefined;
  while (true) {
    const conn = await listener.accept();
    let reply: DaemonReply = { code: 1, stderr: "", stale: true };
    try {
      const line = await lineFrom(conn);
      // Another daemon checking whether this one answers sends nothing.
      if (line === "") continue;
      const request = JSON.parse<DaemonRequest>(line);
      if (request.fishc === digest) {
        const wanted = slotKey(request);
        if (wanted !== key) kept = undefined;
        const start = performance.now();
        let served = build(request, kept);
        let { reply: answer, kept: next } = served;
        kept = next;
        key = kept === undefined ? "" : wanted;
        const carried = kept === undefined ? 0 : kept.carried;
        console.error(`[fishc] ${request.command} ${request.file}: exit ${answer.code} in ${(performance.now() - start).toFixed(0)} ms, ${carried} build(s) in a row from kept state`);
        reply = answer;
      }
    } catch (e) {
      console.error(`[fishc] daemon: ${(e as { message: string }).message}`);
      kept = undefined;
      key = "";
    }
    try {
      await conn.write(new TextEncoder().encode(JSON.stringify(reply)));
    } catch (_e) {
      // The client went away; its build is still kept.
    }
  }
}
