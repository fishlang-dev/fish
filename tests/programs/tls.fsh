// TLS: serve terminating it, with fetch and tls.connect as clients, using the test-only
// certificates in tests/fixtures/tls, a test CA and a certificate it signed for localhost and
// 127.0.0.1.
// case: tls_https
// expect: 200 GET https://localhost:PORT/hi 0
// expect: by address: 200 GET https://127.0.0.1:PORT/hi 0
// expect: post: 201 POST https://localhost:PORT/up 100000
// fetch of https: URLs, the server's requests seeing https: URLs, and a body over many records.
import { readFileSync } from "node:fs";

async function main(): Promise<void> throws IoError | AbortError {
  const dir = "tests/fixtures/tls/";
  const ca = readFileSync(dir + "ca.pem", "utf8");
  const found = shared({ port: new Atomic(0) });
  const seen = found.clone();
  const keys = { cert: readFileSync(dir + "server.pem", "utf8"), key: readFileSync(dir + "server-key.pem", "utf8") };
  spawn(serve({ port: 0, hostname: "127.0.0.1", tls: keys, onListen: (info: ServeInfo) => { seen.port.store(info.port); } }, async (req: Request) => {
    const body = await req.text();
    return new Response(req.method + " " + req.url + " " + String(body.length), { status: req.method === "POST" ? 201 : 200 });
  }));
  while (found.port.load() === 0) await sleep(1);
  const port = String(found.port.load());
  const res = await fetch("https://localhost:" + port + "/hi", { tls: { ca: ca } });
  const text = await res.text();
  console.log(res.status, text.replace(port, "PORT"));
  const direct = await fetch("https://127.0.0.1:" + port + "/hi", { tls: { ca: ca } });
  const said = await direct.text();
  console.log("by address:", direct.status, said.replace(port, "PORT"));
  const post = await fetch("https://localhost:" + port + "/up", { method: "POST", body: "x".repeat(100000), tls: { ca: ca } });
  const posted = await post.text();
  console.log("post:", post.status, posted.replace(port, "PORT"));
}
// case: tls_connect
// expect: first: HTTP/1.1 200 OK
// expect: body: GET https://localhost/a
// expect: clone: HTTP/1.1 200 OK
// expect: end: 0
// tls.connect gives a TcpStream: reads, writes and a clone's writes go over one TLS stream, and
// the stream ends when the server closes it.
import { readFileSync } from "node:fs";

async function readUntil(conn: Ref<TcpStream>, end: string): Promise<string> throws IoError | AbortError {
  let got: u8[] = [];
  while (!new TextDecoder().decode(got).endsWith(end)) {
    const more = await conn.read(4096);
    if (more.length === 0) break;
    for (const b of more) got.push(b);
  }
  return new TextDecoder().decode(got);
}

async function main(): Promise<void> throws IoError | AbortError {
  const dir = "tests/fixtures/tls/";
  const ca = readFileSync(dir + "ca.pem", "utf8");
  const found = shared({ port: new Atomic(0) });
  const seen = found.clone();
  const keys = { cert: readFileSync(dir + "server.pem", "utf8"), key: readFileSync(dir + "server-key.pem", "utf8") };
  spawn(serve({ port: 0, hostname: "127.0.0.1", tls: keys, onListen: (info: ServeInfo) => { seen.port.store(info.port); } }, async (req: Request) => {
    return new Response(req.method + " " + req.url);
  }));
  while (found.port.load() === 0) await sleep(1);
  const conn = await tls.connect("127.0.0.1", found.port.load(), { ca: ca, serverName: "localhost" });
  await conn.write(new TextEncoder().encode("GET /a HTTP/1.1\r\nhost: localhost\r\n\r\n"));
  const first = await readUntil(conn, "/a");
  console.log("first:", first.split("\r\n")[0]);
  console.log("body:", first.split("\r\n\r\n")[1]);
  const other = conn.clone();
  await other.write(new TextEncoder().encode("GET /b HTTP/1.1\r\nhost: localhost\r\nconnection: close\r\n\r\n"));
  const second = await readUntil(conn, "/b");
  console.log("clone:", second.split("\r\n")[0]);
  const end = await conn.read(16);
  console.log("end:", end.length);
}
// case: tls_rejects
// expect: untrusted: UNABLE_TO_GET_ISSUER_CERT_LOCALLY certificate verify failed: unable to get local issuer certificate
// expect: wrong name: ERR_TLS_CERT_ALTNAME_INVALID certificate verify failed: hostname mismatch
// expect: bad ca: the 'ca' option holds no PEM certificate
// expect: plain: the server closed the connection
// expect: still serving: 200
// expect: bad key: serve can't use its tls option: the TLS 'key' holds no PEM private key
// A certificate the system doesn't trust and one for another name are refused with Node's
// codes; a plain HTTP request to the TLS port ends that connection, not the server; a key that
// isn't PEM stops serve before it listens.
import { readFileSync } from "node:fs";

async function refused(what: string, host: string, port: i64, ca: string, name: string): Promise<void> {
  try {
    const _conn = await tls.connect(host, port, { ca: ca, serverName: name });
    console.log(what + ": connected");
  } catch (e) {
    if (e instanceof IoError) console.log(what + ": " + (e.code.length > 0 ? e.code + " " : "") + e.message);
    else console.log(what + ": aborted");
  }
}

async function main(): Promise<void> throws IoError | AbortError {
  const dir = "tests/fixtures/tls/";
  const ca = readFileSync(dir + "ca.pem", "utf8");
  const found = shared({ port: new Atomic(0) });
  const seen = found.clone();
  const cert = readFileSync(dir + "server.pem", "utf8");
  spawn(serve({ port: 0, hostname: "127.0.0.1", tls: { cert: cert.clone(), key: readFileSync(dir + "server-key.pem", "utf8") }, onListen: (info: ServeInfo) => { seen.port.store(info.port); } }, async (_req: Request) => {
    return new Response("ok");
  }));
  while (found.port.load() === 0) await sleep(1);
  const port = found.port.load();
  try {
    const res = await fetch("https://localhost:" + String(port) + "/");
    console.log("untrusted: got", res.status);
  } catch (e) {
    if (e instanceof IoError) console.log("untrusted: " + e.code, e.message);
  }
  await refused("wrong name", "127.0.0.1", port, ca, "wrong.example");
  await refused("bad ca", "127.0.0.1", port, "not a certificate", "localhost");
  const plain = await TcpStream.connect("127.0.0.1", port);
  await plain.write(new TextEncoder().encode("GET / HTTP/1.1\r\nhost: localhost\r\n\r\n"));
  let closed = false;
  try {
    while (!closed) {
      const got = await plain.read(4096, AbortSignal.timeout(5000));
      closed = got.length === 0;
    }
  } catch (e) {
    closed = e instanceof IoError;
  }
  console.log("plain:", closed ? "the server closed the connection" : "still open");
  const res = await fetch("https://localhost:" + String(port) + "/", { tls: { ca: ca } });
  console.log("still serving:", res.status);
  try {
    await serve({ port: 0, hostname: "127.0.0.1", tls: { cert: cert, key: "not a key" } }, async (_req: Request) => new Response("no"));
  } catch (e) {
    console.log("bad key: " + e.message);
  }
}
// case: tls_timeout
// expect: silent client closed: true
// expect: after: 200
// A client that connects but never starts the handshake is closed after idleTimeout, as one
// that never sends a request is, and the server goes on serving.
import { readFileSync } from "node:fs";

async function main(): Promise<void> throws IoError | AbortError {
  const dir = "tests/fixtures/tls/";
  const ca = readFileSync(dir + "ca.pem", "utf8");
  const found = shared({ port: new Atomic(0) });
  const seen = found.clone();
  const keys = { cert: readFileSync(dir + "server.pem", "utf8"), key: readFileSync(dir + "server-key.pem", "utf8") };
  spawn(serve({ port: 0, hostname: "127.0.0.1", tls: keys, idleTimeout: 200, onListen: (info: ServeInfo) => { seen.port.store(info.port); } }, async (_req: Request) => {
    return new Response("ok");
  }));
  while (found.port.load() === 0) await sleep(1);
  const port = found.port.load();
  const silent = await TcpStream.connect("127.0.0.1", port);
  const started = performance.now();
  const got = await silent.read(16, AbortSignal.timeout(5000));
  console.log("silent client closed:", got.length === 0 && performance.now() - started < 4000);
  const res = await fetch("https://127.0.0.1:" + String(port) + "/", { tls: { ca: ca } });
  console.log("after:", res.status);
}
