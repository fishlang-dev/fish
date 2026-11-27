// Runs the playground's compiler, fishc built for wasm32-wasip1, once per request: the request
// goes in on stdin and the answer comes out on stdout. The module is compiled once and
// instantiated fresh for each run, so no run sees another's memory.
const modulePromise = fetch("fishc.wasm").then((r) => {
  if (!r.ok) throw new Error(`fishc.wasm: ${r.status}; build it with scripts/playground.fsh`);
  return r.arrayBuffer();
}).then((bytes) => WebAssembly.compile(bytes));

class Exit {
  constructor(code) { this.code = code; }
}

// The WASI calls a command module that reads stdin and writes stdout makes. Everything that would
// reach a file, a socket or another program fails with ENOSYS or EBADF.
function wasi(stdin, out, err) {
  let memory;
  let read = 0;
  const view = () => new DataView(memory.buffer);
  const bytes = () => new Uint8Array(memory.buffer);
  const EBADF = 8, ENOSYS = 52, SUCCESS = 0;
  const strings = (list, ptrs, buf) => {
    const enc = new TextEncoder();
    let at = buf;
    list.forEach((s, i) => {
      const b = enc.encode(s + "\0");
      view().setUint32(ptrs + i * 4, at, true);
      bytes().set(b, at);
      at += b.length;
    });
    return SUCCESS;
  };
  const sizes = (list, count, size) => {
    view().setUint32(count, list.length, true);
    view().setUint32(size, list.reduce((n, s) => n + new TextEncoder().encode(s).length + 1, 0), true);
    return SUCCESS;
  };
  const args = ["fishc"];
  const env = [];
  const imports = {
    args_get: (p, b) => strings(args, p, b),
    args_sizes_get: (c, s) => sizes(args, c, s),
    environ_get: (p, b) => strings(env, p, b),
    environ_sizes_get: (c, s) => sizes(env, c, s),
    clock_res_get: (_id, res) => { view().setBigUint64(res, 1000n, true); return SUCCESS; },
    clock_time_get: (id, _precision, time) => {
      const ms = id === 0 ? Date.now() : performance.now();
      view().setBigUint64(time, BigInt(Math.round(ms * 1e6)), true);
      return SUCCESS;
    },
    random_get: (buf, len) => { crypto.getRandomValues(bytes().subarray(buf, buf + len)); return SUCCESS; },
    fd_write: (fd, iovs, count, written) => {
      if (fd !== 1 && fd !== 2) return EBADF;
      let n = 0;
      for (let i = 0; i < count; i++) {
        const ptr = view().getUint32(iovs + i * 8, true);
        const len = view().getUint32(iovs + i * 8 + 4, true);
        (fd === 1 ? out : err).push(bytes().slice(ptr, ptr + len));
        n += len;
      }
      view().setUint32(written, n, true);
      return SUCCESS;
    },
    fd_read: (fd, iovs, count, got) => {
      if (fd !== 0) return EBADF;
      let n = 0;
      for (let i = 0; i < count && read < stdin.length; i++) {
        const ptr = view().getUint32(iovs + i * 8, true);
        const len = view().getUint32(iovs + i * 8 + 4, true);
        const part = stdin.subarray(read, read + len);
        bytes().set(part, ptr);
        read += part.length;
        n += part.length;
      }
      view().setUint32(got, n, true);
      return SUCCESS;
    },
    fd_fdstat_get: (fd, stat) => {
      if (fd > 2) return EBADF;
      bytes().fill(0, stat, stat + 24);
      view().setUint8(stat, 2);
      return SUCCESS;
    },
    fd_prestat_get: () => EBADF,
    fd_close: () => SUCCESS,
    fd_seek: () => ENOSYS,
    poll_oneoff: (_in, _out, _n, done) => { view().setUint32(done, 0, true); return SUCCESS; },
    sched_yield: () => SUCCESS,
    proc_exit: (code) => { throw new Exit(code); },
  };
  const all = new Proxy(imports, { get: (t, name) => t[name] ?? (() => ENOSYS) });
  return { imports: all, attach: (m) => { memory = m; } };
}

function joined(chunks) {
  const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.length; }
  return new TextDecoder().decode(all);
}

self.onmessage = async (event) => {
  const out = [], err = [];
  try {
    const module = await modulePromise;
    const sys = wasi(new TextEncoder().encode(JSON.stringify({ source: event.data.source })), out, err);
    const instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: sys.imports });
    sys.attach(instance.exports.memory);
    try {
      instance.exports._start();
    } catch (e) {
      if (!(e instanceof Exit)) throw e;
    }
    const text = joined(out);
    if (text.trim() === "") throw new Error(joined(err) || "the compiler gave no answer");
    self.postMessage({ answer: JSON.parse(text) });
  } catch (e) {
    self.postMessage({ failure: `${e.message ?? e}${err.length > 0 ? "\n" + joined(err) : ""}` });
  }
};
