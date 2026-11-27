// Runs the playground's compiler, fishc built with `--target browser` into fishc.wasm and its
// loader fishc.js, once per request: the request goes in on stdin and the answer comes out on
// stdout. Each run is a fresh instance, so no run sees another's memory.
import { run } from "./fishc.js";

self.onmessage = async (event) => {
  const out = [];
  const err = [];
  try {
    const stdin = new TextEncoder().encode(JSON.stringify({ source: event.data.source }));
    const code = await run({ stdin, stdout: (line) => out.push(line), stderr: (line) => err.push(line) });
    const text = out.join("\n");
    if (text.trim() === "") throw new Error(err.join("\n") || `the compiler exited with ${code} and gave no answer`);
    self.postMessage({ answer: JSON.parse(text) });
  } catch (e) {
    self.postMessage({ failure: `${e.message ?? e}${err.length > 0 ? "\n" + err.join("\n") : ""}` });
  }
};
