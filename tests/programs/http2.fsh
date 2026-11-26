// HTTP/2: serve speaking it by prior knowledge and over TLS once ALPN picks it, with curl and
// fetch as clients; curl must be on PATH and built with nghttp2.
// case: h2_prior_knowledge
// expect: get: GET http://127.0.0.1:PORT/p?q=1 a=1 2
// expect: post: 70000 2
// expect: big: 1048576 2
// expect: head: HTTP/2 204
// expect: cookie: set-cookie: s=1; Path=/; SameSite=Lax
// expect: events: data: one|data: two|
// expect: panic: 500
// expect: parallel: 5 done over 1 connection
// Requests and responses over cleartext HTTP/2: headers, a body past the first window, a body of
// many frames, HEAD with a cookie, a streamed body, a handler's panic and streams at once.
import { spawnSync } from "node:child_process";

async function* events(): AsyncGenerator<string | ServerSentEvent> {
  yield "one";
  yield "two";
}

async function curl(args: string[]): Promise<string> {
  const out = await spawnBlocking(() => new TextDecoder().decode(spawnSync("curl", args).stdout));
  return out;
}

async function main(): Promise<void> throws IoError | AbortError {
  const found = shared({ port: new Atomic(0) });
  const seen = found.clone();
  spawn(serve({ port: 0, hostname: "127.0.0.1", onListen: (info: ServeInfo) => { seen.port.store(info.port); } }, async (req: Request) => {
    if (req.path === "/big") return new Response("y".repeat(1048576));
    if (req.path === "/head") {
      let res = new Response(null, { status: 204 });
      res.cookies.set("s", "1");
      return res;
    }
    if (req.path === "/events") return Response.sse(events());
    if (req.path === "/panic") assert(false, "no");
    if (req.path === "/slow") {
      await sleep(200);
      return new Response("done");
    }
    const body = await req.text();
    if (req.method === "POST") return new Response(String(body.length));
    return new Response(req.method + " " + req.url + " a=" + (req.headers.get("x-a") ?? "-"));
  }));
  while (found.port.load() === 0) await sleep(1);
  const port = String(found.port.load());
  const base = "http://127.0.0.1:" + port;
  const h2 = "--http2-prior-knowledge";
  const got1 = await curl(["-s", h2, "-H", "x-a: 1", "-w", " %{http_version}", base + "/p?q=1"]);
  console.log("get:", got1.replace(port, "PORT"));
  const got2 = await curl(["-s", h2, "--data-binary", "x".repeat(70000), "-w", " %{http_version}", base + "/up"]);
  console.log("post:", got2);
  const got3 = await curl(["-s", h2, "-o", "/dev/null", "-w", "%{size_download} %{http_version}", base + "/big"]);
  console.log("big:", got3);
  const got4 = await curl(["-s", h2, "-I", base + "/head"]);
  const head = got4.split("\r\n");
  console.log("head:", head[0].trim());
  for (const line of head) if (line.startsWith("set-cookie")) console.log("cookie:", line);
  const got5 = await curl(["-s", "-N", h2, base + "/events"]);
  console.log("events:", got5.split("\n").filter((l) => l.length > 0).join("|") + "|");
  const got6 = await curl(["-s", h2, "-o", "/dev/null", "-w", "%{http_code}", base + "/panic"]);
  console.log("panic:", got6);
  let urls: string[] = ["-s", h2, "--parallel", "-w", "%{http_code} %{num_connects}\n"];
  for (let i = 0; i < 5; i++) {
    urls.push("-o");
    urls.push("/dev/null");
    urls.push(base + "/slow");
  }
  const said = await curl(urls);
  let done = 0;
  let connects: i64 = 0;
  for (const line of said.split("\n")) {
    if (!line.startsWith("200 ")) continue;
    done += 1;
    connects += parseInt(line.slice(4)) ?? 0;
  }
  console.log("parallel:", done, "done over", connects, "connection");
}
// case: h2_tls
// expect: curl: GET https://localhost:PORT/x none 2
// expect: http/1.1 still: GET https://localhost:PORT/x close 1.1
// expect: fetch: 200 GET https://localhost:PORT/x none
// expect: fetch post: 201 100000
// expect: fetch big: 1048576
// expect: fetch head: 200 0
// ALPN picks h2 for curl and fetch alike, and http/1.1 for a client offering only that; fetch's
// body goes out within the server's windows and a large reply comes in within its own.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

async function curl(args: string[]): Promise<string> {
  const out = await spawnBlocking(() => new TextDecoder().decode(spawnSync("curl", args).stdout));
  return out;
}

async function main(): Promise<void> throws IoError | AbortError {
  const dir = "tests/fixtures/tls/";
  const ca = readFileSync(dir + "ca.pem", "utf8");
  const found = shared({ port: new Atomic(0) });
  const seen = found.clone();
  const keys = { cert: readFileSync(dir + "server.pem", "utf8"), key: readFileSync(dir + "server-key.pem", "utf8") };
  spawn(serve({ port: 0, hostname: "127.0.0.1", tls: keys, onListen: (info: ServeInfo) => { seen.port.store(info.port); } }, async (req: Request) => {
    if (req.path === "/big") return new Response("y".repeat(1048576));
    const body = await req.text();
    if (req.method === "POST") return new Response(String(body.length), { status: 201 });
    // fetch over HTTP/1.1 sends 'connection: close', which HTTP/2 has no place for.
    return new Response(req.method + " " + req.url + " " + (req.headers.get("connection") ?? "none"));
  }));
  while (found.port.load() === 0) await sleep(1);
  const port = String(found.port.load());
  const url = "https://localhost:" + port;
  const resolve = "localhost:" + port + ":127.0.0.1";
  const got7 = await curl(["-s", "--http2", "--cacert", dir + "ca.pem", "--resolve", resolve, "-w", " %{http_version}", url + "/x"]);
  console.log("curl:", got7.replace(port, "PORT"));
  const got8 = await curl(["-s", "--http1.1", "-H", "connection: close", "--cacert", dir + "ca.pem", "--resolve", resolve, "-w", " %{http_version}", url + "/x"]);
  console.log("http/1.1 still:", got8.replace(port, "PORT"));
  const res = await fetch(url + "/x", { tls: { ca: ca } });
  const text = await res.text();
  console.log("fetch:", res.status, text.replace(port, "PORT"));
  const post = await fetch(url + "/up", { method: "POST", body: "x".repeat(100000), tls: { ca: ca } });
  const posted = await post.text();
  console.log("fetch post:", post.status, posted);
  const big = await fetch(url + "/big", { tls: { ca: ca } });
  const bytes = await big.bytes();
  console.log("fetch big:", bytes.length);
  const head = await fetch(url + "/x", { method: "HEAD", tls: { ca: ca } });
  const empty = await head.bytes();
  console.log("fetch head:", head.status, empty.length);
}
// case: h2_hpack
// expect: http://www.example.com/ - -
// expect: http://www.example.com/ no-cache -
// expect: http://www.example.com/index.html - custom-value
// RFC 7541's C.4 requests, Huffman-coded and leaning on the dynamic table, sent as raw frames on
// three streams of one connection.
function hex(s: string): u8[] {
  let out: u8[] = [];
  for (let i: i64 = 0; i + 1 < (s.length as i64); i += 2) out.push((parseInt(s.slice(i, i + 2), 16) ?? 0) as u8);
  return out;
}

async function main(): Promise<void> throws IoError | AbortError {
  const found = shared({ port: new Atomic(0) });
  const seen = found.clone();
  const lines: string[] = [];
  const heard = shared({ lines: new Lock(lines) });
  const tell = heard.clone();
  spawn(serve({ port: 0, hostname: "127.0.0.1", onListen: (info: ServeInfo) => { seen.port.store(info.port); } }, async (req: Request) => {
    const line = req.url + " " + (req.headers.get("cache-control") ?? "-") + " " + (req.headers.get("custom-key") ?? "-");
    tell.lines.update((ls) => { ls.push(line); });
    return new Response("ok");
  }));
  while (found.port.load() === 0) await sleep(1);
  const conn = await TcpStream.connect("127.0.0.1", found.port.load());
  // An empty SETTINGS, then each request as a HEADERS frame ending its header block and stream.
  let out = new TextEncoder().encode("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");
  for (const b of hex("000000040000000000000011010500000001828684418cf1e3c2e5f23a6ba0ab90f4ff00000c010500000003828684be5886a8eb10649cbf000018010500000005828785bf408825a849e95ba97d7f8925a849e95bb8e8b4bf")) out.push(b);
  await conn.write(out);
  while (heard.lines.update((ls) => ls.length) < 3) await sleep(5);
  let got = heard.lines.update((ls) => ls.clone());
  got.sort();
  for (const line of got) console.log(line);
}
