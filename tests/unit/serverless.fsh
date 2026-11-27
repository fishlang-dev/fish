// Serverless and edge builds of one Router app: the zip a Lambda function is uploaded as, the
// targets' flags, the app as an edge module under wasmtime, through the Workers-style loader in
// Node, and as a Lambda bootstrap in AWS's runtime interface emulator. The runs need wasmtime and
// the WASI sysroot, FISH_TEST_NODE=1 and node, or a musl sysroot in FISH_TEST_SYSROOT_MUSL_ARM64 or
// FISH_TEST_SYSROOT_MUSL_AMD64 and Docker, and are skipped without them.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, zipped } from "../../src/serverless.fsh";
import { hostTriple, resolveTarget, type Target } from "../../src/target.fsh";
import { fishc, freePort, removed, same, scratch, text } from "./support.fsh";

function has(_tool: string): string | null {
  return "/usr/bin/tool";
}

function thrown(run: () => Target throws Error): string {
  try {
    const _t = run();
    return "";
  } catch (e) {
    return e.message;
  }
}

function write(path: string, contents: string): void {
  try {
    writeFileSync(path, contents);
  } catch (e) {
    assert(false, `can't write ${path}: ${e.message}`);
  }
}

test("a Lambda zip holds bootstrap, executable, stored", () => {
  const data = new TextEncoder().encode("123456789");
  assert(crc32(data) === 0xcbf43926, `crc32: ${crc32(data)}`);
  const zip = zipped("bootstrap", data);
  assert(zip[0]! === 0x50 && zip[1]! === 0x4b && zip[2]! === 3 && zip[3]! === 4, "a local file header");
  same(new TextDecoder().decode(zip.slice(30, 39)), "bootstrap", "the name");
  same(new TextDecoder().decode(zip.slice(39, 48)), "123456789", "the stored bytes");
  const end = zip.length - 22;
  assert(zip[end]! === 0x50 && zip[end + 1]! === 0x4b && zip[end + 2]! === 5 && zip[end + 3]! === 6, "an end of central directory");
  // The central entry's external attributes hold the mode 0100755 in their high half.
  const attributes = 48 + 38;
  assert(zip[attributes + 2]! === 0xed && zip[attributes + 3]! === 0x81, "an executable mode");
});

test("lambda is a static musl build, and edge a wasm32-wasip1 module", () => {
  const lambda = resolveTarget("lambda", "/w/musl", "aarch64-apple-darwin", has);
  same(lambda.triple, "lambda", "lambda's triple");
  same(lambda.compile.slice(0, 2).join(" "), "-target x86_64-unknown-linux-musl", "lambda's compile");
  assert(lambda.link.includes("-static"), `lambda links statically: ${lambda.link.join(" ")}`);
  same(resolveTarget("lambda-arm64", "/w/musl", "aarch64-apple-darwin", has).compile[1]!, "aarch64-unknown-linux-musl", "lambda-arm64");
  assert(thrown(() => resolveTarget("lambda", undefined, "aarch64-apple-darwin", has)).includes("needs a musl sysroot"), "lambda without a sysroot");
  const edge = resolveTarget("edge", "/w/wasi", undefined, has, (_p) => true);
  same(edge.triple, "edge", "edge's triple");
  same(edge.compile.slice(0, 2).join(" "), "-target wasm32-wasip1", "edge's compile");
});

const APP = `async function main(): Promise<void> throws IoError {
  let app = new Router();
  app.get("/hello/:name", async (req) => {
    let res = new Response("hello " + req.param("name"));
    res.headers.set("x-made-by", "fish");
    return res;
  });
  await serve({ port: 8080 }, app.handler());
}
`;

// What an edge module answered, as status and the body's text, from the JSON it wrote.
type Answer = { status: i64; headers: string[][]; body: string };

function wasmReady(): boolean {
  if (Bun.which("wasmtime") === null) return false;
  return thrown(() => resolveTarget("edge", process.env.FISH_SYSROOT)) === "";
}

function edgeBuild(): string {
  const dir = scratch("fish-edge-");
  write(join(dir, "main.fsh"), APP);
  const built = fishc(dir, ["build", "main.fsh", "--target", "edge"]);
  same(built.err, "", "the edge build's stderr");
  assert(existsSync(join(dir, "main.wasm")) && existsSync(join(dir, "main.js")), "main.wasm and main.js were written");
  return dir;
}

test("an edge module answers a request under wasmtime", () => {
  if (!wasmReady()) {
    console.log("skipped: running an edge module needs wasi-libc, wasi-runtimes and wasmtime");
    return;
  }
  const dir = edgeBuild();
  const asked = '{"method":"GET","url":"http://edge.test/hello/fish","headers":[["accept","text/plain"]],"body":""}';
  const run = spawnSync("wasmtime", ["run", "main.wasm"], { cwd: dir, input: asked });
  same(text(run.stderr), "", "the module's stderr");
  let answer: Answer = { status: 0, headers: [], body: "" };
  try {
    answer = JSON.parse<Answer>(text(run.stdout));
  } catch (e) {
    assert(false, `the module's answer ${text(run.stdout)}: ${e.message}`);
  }
  assert(answer.status === 200, `status ${answer.status}`);
  let body = "";
  try {
    body = new TextDecoder().decode(u8.fromBase64(answer.body));
  } catch (e) {
    assert(false, `the body ${answer.body}: ${e.message}`);
  }
  same(body, "hello fish", "the body");
  assert(answer.headers.some((h) => h.length === 2 && h[0]! === "x-made-by" && h[1]! === "fish"), "the handler's header");
  removed(dir);
});

test("an edge module answers a Workers-style fetch in Node", () => {
  if (process.env.FISH_TEST_NODE !== "1" || Bun.which("node") === null || !wasmReady()) {
    console.log("skipped: the Workers-style loader runs under Node, with FISH_TEST_NODE=1, node and the WASI sysroot");
    return;
  }
  const dir = edgeBuild();
  write(join(dir, "worker.mjs"), `import { readFileSync } from "node:fs";
import { edge } from "./main.js";
const worker = edge(new WebAssembly.Module(readFileSync(new URL("./main.wasm", import.meta.url))));
const res = await worker.fetch(new Request("http://edge.test/hello/node"));
console.log(res.status, res.headers.get("x-made-by"), await res.text());
`);
  const run = spawnSync("node", ["worker.mjs"], { cwd: dir });
  same(text(run.stdout), "200 fish hello node\n", `node's output, with stderr ${text(run.stderr)}`);
  removed(dir);
});

function docker(): boolean {
  if (Bun.which("docker") === null) return false;
  return spawnSync("docker", ["info"]).status === 0;
}

test("a Lambda bootstrap answers an invocation in the runtime interface emulator", () => {
  const arm = process.env.FISH_TEST_SYSROOT_MUSL_ARM64 ?? "";
  const amd = process.env.FISH_TEST_SYSROOT_MUSL_AMD64 ?? "";
  // The emulator runs natively for this machine's architecture when there's a sysroot for it.
  const armFirst = arm !== "" && (amd === "" || (hostTriple() ?? "").startsWith("aarch64"));
  const sysroot = armFirst ? arm : amd;
  if (sysroot === "" || !docker() || Bun.which("unzip") === null || Bun.which("curl") === null) {
    console.log("skipped: running a Lambda bootstrap needs FISH_TEST_SYSROOT_MUSL_ARM64 or _AMD64, Docker, unzip and curl");
    return;
  }
  const dir = scratch("fish-lambda-");
  write(join(dir, "main.fsh"), APP);
  const built = fishc(dir, ["build", "main.fsh", "--target", armFirst ? "lambda-arm64" : "lambda", "--sysroot", sysroot]);
  same(built.err, "", "the lambda build's stderr");
  assert(spawnSync("unzip", ["-o", "main.zip", "-d", "runtime"], { cwd: dir }).status === 0, "main.zip unzipped");
  const port = freePort();
  const name = `fish-lambda-test-${port}`;
  const started = spawnSync("docker", ["run", "-d", "--rm", "--name", name, "--platform", armFirst ? "linux/arm64" : "linux/amd64", "-p", `${port}:8080`, "-v", `${join(dir, "runtime")}:/var/runtime`, "public.ecr.aws/lambda/provided:al2023", "function.handler"]);
  assert(started.status === 0, `the emulator didn't start: ${text(started.stderr)}`);
  const event = '{"version":"2.0","rawPath":"/hello/lambda","rawQueryString":"","headers":{"accept":"text/plain"},"requestContext":{"domainName":"lambda.test","http":{"method":"GET"}},"isBase64Encoded":false}';
  let reply = "";
  for (let i = 0; i < 60 && reply === ""; i++) {
    const asked = spawnSync("curl", ["-s", "--max-time", "5", "-d", event, `http://127.0.0.1:${port}/2015-03-31/functions/function/invocations`]);
    if (asked.status === 0) reply = text(asked.stdout);
    else spawnSync("sleep", ["1"]);
  }
  spawnSync("docker", ["rm", "-f", name]);
  assert(reply.includes('"statusCode":200'), `the invocation's result: ${reply}`);
  assert(reply.includes('"x-made-by":"fish"'), `the handler's header: ${reply}`);
  // "hello lambda" in base64.
  assert(reply.includes('"body":"aGVsbG8gbGFtYmRh"'), `the body: ${reply}`);
  removed(dir);
});
