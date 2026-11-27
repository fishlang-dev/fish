// What `--target browser` writes beside its module: an ES module giving it the WASI preview 1 calls
// it makes, so the program runs in a page as it does under a WASI runtime. Standard output and
// error go to callbacks, the console's by default, a line at a time; there are no files, so every
// call on a path or a directory answers that there's no such descriptor.

// Every call WASI preview 1 defines, which a module may import. Those the loader doesn't serve
// answer ENOSYS.
export const WASI_CALLS = ["args_get", "args_sizes_get", "environ_get", "environ_sizes_get", "clock_res_get", "clock_time_get", "fd_advise", "fd_allocate", "fd_close", "fd_datasync", "fd_fdstat_get", "fd_fdstat_set_flags", "fd_fdstat_set_rights", "fd_filestat_get", "fd_filestat_set_size", "fd_filestat_set_times", "fd_pread", "fd_prestat_get", "fd_prestat_dir_name", "fd_pwrite", "fd_read", "fd_readdir", "fd_renumber", "fd_seek", "fd_sync", "fd_tell", "fd_write", "path_create_directory", "path_filestat_get", "path_filestat_set_times", "path_link", "path_open", "path_readlink", "path_remove_directory", "path_rename", "path_symlink", "path_unlink_file", "poll_oneoff", "proc_exit", "proc_raise", "sched_yield", "random_get", "sock_accept", "sock_recv", "sock_send", "sock_shutdown"];

// The files a browser build writes for `out`: the module and its loader, named alike.
export function browserFiles(out: string): { module: string; loader: string } {
  const base = out.replace(/\.(js|mjs|wasm)$/, "");
  return { module: `${base}.wasm`, loader: `${base}.js` };
}

// The loader for the module named `module`, found beside it.
export function loader(module: string): string {
  return LOADER.replace("__FISH_MODULE__", JSON.stringify(module)).replace("__WASI_CALLS__", JSON.stringify(WASI_CALLS));
}

// poll_oneoff can't block a page's main thread, so a sleep there spins until its deadline; in a
// worker, where Atomics.wait may block, it waits.
const LOADER = String.raw`// Runs a Fish program built with 'fishc build --target browser'.
//   import { run } from "./app.js";
//   const code = await run({ args: ["a"], env: { KEY: "v" }, stdout: (line) => ..., stderr: (line) => ... });
const MODULE = __FISH_MODULE__;
const CALLS = __WASI_CALLS__;
const ESUCCESS = 0, EBADF = 8, EINVAL = 28, ENOSYS = 52, ESPIPE = 70;

class Exit {
  constructor(code) {
    this.code = code;
  }
}

function lines(write) {
  const decoder = new TextDecoder();
  let pending = "";
  return {
    push(bytes) {
      pending += decoder.decode(bytes, { stream: true });
      let at;
      while ((at = pending.indexOf("\n")) >= 0) {
        write(pending.slice(0, at));
        pending = pending.slice(at + 1);
      }
    },
    flush() {
      pending += decoder.decode();
      if (pending !== "") write(pending);
      pending = "";
    },
  };
}

function strings(list) {
  const encoder = new TextEncoder();
  return list.map((s) => {
    const bytes = encoder.encode(s);
    const out = new Uint8Array(bytes.length + 1);
    out.set(bytes);
    return out;
  });
}

let sleeper;
function sleepUntil(deadline) {
  for (;;) {
    const left = deadline - performance.now();
    if (left <= 0) return;
    try {
      sleeper ??= new Int32Array(new SharedArrayBuffer(4));
      Atomics.wait(sleeper, 0, 0, left);
    } catch (_e) {
      while (performance.now() < deadline) {}
    }
  }
}

export async function run(options = {}) {
  const args = strings([MODULE, ...(options.args ?? [])]);
  const env = strings(Object.entries(options.env ?? {}).map(([k, v]) => k + "=" + v));
  const out = lines(options.stdout ?? ((line) => console.log(line)));
  const err = lines(options.stderr ?? ((line) => console.error(line)));
  let input = options.stdin ?? new Uint8Array(0);
  let memory;
  const view = () => new DataView(memory.buffer);
  const bytes = () => new Uint8Array(memory.buffer);
  const table = (list) => ({
    sizes(countAt, sizeAt) {
      view().setUint32(countAt, list.length, true);
      view().setUint32(sizeAt, list.reduce((n, s) => n + s.length, 0), true);
      return ESUCCESS;
    },
    get(pointersAt, bufferAt) {
      for (const s of list) {
        view().setUint32(pointersAt, bufferAt, true);
        bytes().set(s, bufferAt);
        pointersAt += 4;
        bufferAt += s.length;
      }
      return ESUCCESS;
    },
  });
  const argv = table(args), environ = table(env);
  const now = (id) => (id === 0 ? BigInt(Date.now()) * 1000000n : BigInt(Math.round(performance.now() * 1e6)));
  const wasi = {
    args_sizes_get: argv.sizes,
    args_get: argv.get,
    environ_sizes_get: environ.sizes,
    environ_get: environ.get,
    clock_res_get(_id, at) {
      view().setBigUint64(at, 1000n, true);
      return ESUCCESS;
    },
    clock_time_get(id, _precision, at) {
      if (id > 3) return EINVAL;
      view().setBigUint64(at, now(id), true);
      return ESUCCESS;
    },
    fd_fdstat_get(fd, at) {
      if (fd > 2) return EBADF;
      const v = view();
      v.setUint8(at, 2);
      v.setUint16(at + 2, 0, true);
      v.setBigUint64(at + 8, 0xffffffffn, true);
      v.setBigUint64(at + 16, 0n, true);
      return ESUCCESS;
    },
    fd_prestat_get: () => EBADF,
    fd_close: (fd) => (fd > 2 ? EBADF : ESUCCESS),
    fd_seek: (fd) => (fd > 2 ? EBADF : ESPIPE),
    fd_sync: (fd) => (fd > 2 ? EBADF : ESUCCESS),
    fd_write(fd, iovs, count, writtenAt) {
      if (fd !== 1 && fd !== 2) return EBADF;
      let written = 0;
      for (let i = 0; i < count; i++) {
        const base = view().getUint32(iovs + i * 8, true);
        const length = view().getUint32(iovs + i * 8 + 4, true);
        (fd === 1 ? out : err).push(bytes().slice(base, base + length));
        written += length;
      }
      view().setUint32(writtenAt, written, true);
      return ESUCCESS;
    },
    fd_read(fd, iovs, count, readAt) {
      if (fd !== 0) return EBADF;
      let read = 0;
      for (let i = 0; i < count && input.length > 0; i++) {
        const base = view().getUint32(iovs + i * 8, true);
        const length = view().getUint32(iovs + i * 8 + 4, true);
        const taken = input.subarray(0, length);
        bytes().set(taken, base);
        input = input.subarray(taken.length);
        read += taken.length;
      }
      view().setUint32(readAt, read, true);
      return ESUCCESS;
    },
    random_get(at, length) {
      for (let i = 0; i < length; i += 65536) crypto.getRandomValues(new Uint8Array(memory.buffer, at + i, Math.min(65536, length - i)));
      return ESUCCESS;
    },
    // A subscription is 48 bytes: userdata, a tag, then a clock's id, timeout, precision and flags;
    // an event is 32: userdata, an error and its type. Descriptors are always ready.
    poll_oneoff(subscriptions, events, count, eventsAt) {
      const v = view();
      let deadline = Infinity;
      for (let i = 0; i < count; i++) {
        const s = subscriptions + i * 48;
        if (v.getUint8(s + 8) !== 0) {
          deadline = performance.now();
          continue;
        }
        const id = v.getUint32(s + 16, true);
        const timeout = v.getBigUint64(s + 24, true);
        const absolute = (v.getUint16(s + 40, true) & 1) !== 0;
        const wait = absolute ? Number(timeout - now(id)) / 1e6 : Number(timeout) / 1e6;
        deadline = Math.min(deadline, performance.now() + Math.max(0, wait));
      }
      if (deadline !== Infinity) sleepUntil(deadline);
      let n = 0;
      const after = view();
      for (let i = 0; i < count; i++) {
        const s = subscriptions + i * 48;
        const e = events + n * 32;
        after.setBigUint64(e, after.getBigUint64(s, true), true);
        after.setUint16(e + 8, 0, true);
        after.setUint8(e + 10, after.getUint8(s + 8));
        n++;
      }
      after.setUint32(eventsAt, n, true);
      return ESUCCESS;
    },
    proc_exit(code) {
      throw new Exit(code);
    },
    sched_yield: () => ESUCCESS,
  };
  const imports = {};
  for (const name of CALLS) imports[name] = wasi[name] ?? (() => ENOSYS);
  const source = options.module ?? fetch(new URL(MODULE, import.meta.url));
  const loaded = source instanceof Promise || source instanceof Response ? await WebAssembly.instantiateStreaming(source, { wasi_snapshot_preview1: imports }) : await WebAssembly.instantiate(source, { wasi_snapshot_preview1: imports });
  memory = loaded.instance.exports.memory;
  try {
    loaded.instance.exports._start();
    return 0;
  } catch (e) {
    if (e instanceof Exit) return e.code;
    throw e;
  } finally {
    out.flush();
    err.flush();
  }
}
`;
