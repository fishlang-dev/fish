// TLS between Fish and implementations that aren't Fish's, both ways, with the test-only
// certificates in tests/fixtures/tls: OpenSSL's own server answers Fish's client, and curl fetches
// from Fish's server. The other side runs as a child process in the background under `sh`.
//
// Left out: "a stream already speaking TLS refuses to start it again, leaking nothing". It stands a
// module in for std's own by adding it to std's module table in process, as only std may start
// TLS; Fish's table is a deeply immutable const, and a file only named like std's gets no std
// allowances, so a Fish test has no way to call std's TLS helper a second time.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NATIVE, tlsStub } from "../../src/native.fsh";
import { findOpenSsl, type OpenSsl, type Target } from "../../src/target.fsh";
import { built, fishc, freePort, removed, root, same, scratch, text } from "./support.fsh";

function fixtures(): string {
  return join(root(), "tests", "fixtures", "tls");
}

function write(path: string, contents: string): void {
  try {
    writeFileSync(path, contents);
  } catch (e) {
    assert(false, `can't write ${path}: ${e.message}`);
  }
}

function readText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    assert(false, `can't read ${path}: ${e.message}`);
    return "";
  }
}

// Fetches its first argument, trusting the PEM file its second names, or the system's
// certificates when it is empty.
function client(): string {
  return `import { readFileSync } from "node:fs";

async function main(): Promise<void> throws IoError {
  const url = process.argv[2];
  const ca = process.argv[3] === "" ? "" : readFileSync(process.argv[3], "utf8");
  try {
    const res = await fetch(url, { tls: { ca: ca } });
    const text = await res.text();
    console.log(res.status, text);
  } catch (e) {
    if (e instanceof IoError) console.log(e.code, e.message);
    else console.log("aborted");
  }
}
`;
}

test("a Fish client fetches from OpenSSL's HTTPS server, and refuses it untrusted", () => {
  const tmp = scratch("fish-tls-");
  const binary = built(tmp, "client", client());
  // `-WWW` answers a GET with the file of its path, from the directory it runs in.
  const www = join(tmp, "www");
  try {
    mkdirSync(www);
  } catch (e) {
    assert(false, e.message);
  }
  write(join(www, "x"), "openssl /x");
  const port = freePort();
  // Each client run's exit code, then its stdout and stderr, in files of their own.
  const script = `cd "$5" && openssl s_server -quiet -accept "$6" -cert "$7/server.pem" -key "$7/server-key.pem" -WWW > /dev/null 2> "$2/openssl.err" & peer=$!
n=0
until curl -s -k -o /dev/null "https://localhost:$6/x" || [ $n -ge 200 ]; do sleep 0.05; n=$((n + 1)); done
env FISH_LEAKS=1 "$3" "https://localhost:$6/x" "$4" > "$2/out1" 2> "$2/err1"; echo $? > "$2/code1"
env FISH_LEAKS=1 "$3" "https://localhost:$6/x" "" > "$2/out2" 2> "$2/err2"; echo $? > "$2/code2"
kill $peer`;
  spawnSync("sh", ["-c", script, "sh", "", tmp, binary, join(fixtures(), "ca.pem"), www, `${port}`, fixtures()]);
  same(readText(join(tmp, "openssl.err")), "", "OpenSSL's stderr");
  same(`${readText(join(tmp, "code1")).trim()} ${readText(join(tmp, "err1"))}${readText(join(tmp, "out1"))}`, "0 200 openssl /x\n", "the trusting client's exit code, stderr and output");
  same(`${readText(join(tmp, "code2")).trim()} ${readText(join(tmp, "err2"))}${readText(join(tmp, "out2"))}`, "0 UNABLE_TO_GET_ISSUER_CERT_LOCALLY certificate verify failed: unable to get local issuer certificate\n", "the untrusting client's exit code, stderr and output");
  removed(tmp);
}, { timeout: 60_000 });

test("curl reaches a Fish HTTPS server, trusting the test CA", () => {
  const tmp = scratch("fish-tls-");
  const binary = built(tmp, "server", `import { readFileSync } from "node:fs";

async function main(): Promise<void> throws IoError {
  const dir = process.argv[2];
  const keys = { cert: readFileSync(dir + "/server.pem", "utf8"), key: readFileSync(dir + "/server-key.pem", "utf8") };
  await serve({ port: parseInt(process.argv[3]) ?? 0, hostname: "127.0.0.1", tls: keys }, async (req: Request) => {
    return new Response("fish " + req.url);
  });
}
`);
  // A port free a moment ago, since the server's stdout is buffered until it exits.
  const port = freePort();
  // curl prints the body, then the status after a space; tried until the server is up.
  const script = `"$1" "$2" "$3" > /dev/null 2>&1 & server=$!
n=0
until body=$(curl -sS --cacert "$4" -w " %{http_code}" "https://localhost:$3/y" 2> /dev/null) || [ $n -ge 100 ]; do sleep 0.05; n=$((n + 1)); done
if [ -z "$body" ]; then echo "the Fish server never answered"; else echo "\${body##* } \${body% *}"; fi
kill $server`;
  const run = spawnSync("sh", ["-c", script, "sh", binary, fixtures(), `${port}`, join(fixtures(), "ca.pem")]);
  same(text(run.stderr), "", "the script's stderr");
  same(text(run.stdout), `200 fish https://localhost:${port}/y\n`, "what curl got");
  removed(tmp);
}, { timeout: 60_000 });

test("std's TLS helper is std's alone", () => {
  const tmp = scratch("fish-tls-");
  const file = join(tmp, "helper.fsh");
  write(file, `async function main(): Promise<void> throws IoError | AbortError {
  const conn = await TcpStream.connect("127.0.0.1", 1, new AbortController().signal);
  await __tlsClient(conn, "localhost", "", new AbortController().signal);
}
`);
  const run = fishc(tmp, ["build", file, "-o", join(tmp, "helper")]);
  assert(run.code !== 0, "the build succeeded");
  assert(/: error\[E\d+\]: unknown function '__tlsClient'/.test(run.err), `not a compile error about '__tlsClient':\n${run.err}`);
  removed(tmp);
}, { timeout: 60_000 });

function shown(o: Ref<OpenSsl>): string {
  return "missing" in o ? `missing: ${o.missing}` : `compile: ${JSON.stringify(o.compile)} link: ${JSON.stringify(o.link)}`;
}

function musl(compile: string[]): Target {
  return { triple: "x86_64-unknown-linux-musl", compile, link: [], ar: "llvm-ar" };
}

test("OpenSSL for another target is looked for only in its sysroot", () => {
  const tmp = scratch("fish-tls-");
  const sysroot = join(tmp, "sysroot");
  try {
    mkdirSync(sysroot);
  } catch (e) {
    assert(false, e.message);
  }
  same(shown(findOpenSsl(musl(["-target", "x86_64-unknown-linux-musl"]))), "missing: TLS needs OpenSSL built for x86_64-unknown-linux-musl, and no sysroot was given; install OpenSSL's headers and libraries into a sysroot for that target and build the program again", "with no sysroot");
  const empty = findOpenSsl(musl(["-target", "x86_64-unknown-linux-musl", "--sysroot", sysroot]));
  assert("missing" in empty, `found in an empty sysroot: ${shown(empty)}`);
  try {
    mkdirSync(join(sysroot, "usr", "include", "openssl"), { recursive: true });
  } catch (e) {
    assert(false, e.message);
  }
  write(join(sysroot, "usr", "include", "openssl", "ssl.h"), "");
  same(shown(findOpenSsl(musl(["-target", "x86_64-unknown-linux-musl", "--sysroot", sysroot]))), `compile: [] link: ["-lssl","-lcrypto"]`, "with the headers in the sysroot");
  removed(tmp);
}, { timeout: 60_000 });

test("the runtime without OpenSSL compiles, its TLS calls saying why", () => {
  const tmp = scratch("fish-tls-");
  const object = join(tmp, "stub.o");
  const clang = spawnSync("clang", ["-x", "c", "-", "-c", "-o", object], { input: NATIVE + tlsStub("TLS needs \"OpenSSL\"") });
  assert(!text(clang.stderr).includes("error"), `clang's errors:\n${text(clang.stderr)}`);
  assert(clang.status === 0, `clang exited with ${clang.status ?? -1}`);
  removed(tmp);
}, { timeout: 60_000 });
