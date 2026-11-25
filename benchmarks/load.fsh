// The HTTP load generator: keep-alive connections that each send their share of the requests to
// one path, one after another, and what they measured printed as one line of JSON.
//   load <port> <path> <connections> <requests> [<file whose text is POSTed>]
// A response must be a 200 with a Content-Length; anything else is counted as an error and ends
// that connection's share.
import { readFileSync } from "node:fs";

type Share = { latencies: f64[]; error: string };

// Where a response's head ends in what was read so far, or -1.
function headEnd(buf: Ref<u8[]>): i64 {
  for (let i: usize = 3; i < buf.length; i++) if (buf[i] === 10 && buf[i - 1] === 13 && buf[i - 2] === 10 && buf[i - 3] === 13) return (i as i64) + 1;
  return -1;
}

function contentLength(head: string): i64 {
  for (const line of head.split("\r\n")) {
    const at = line.indexOf(":");
    if (at > 0 && line.slice(0, at).toLowerCase() === "content-length") return parseInt(line.slice(at + 1).trim()) ?? -1;
  }
  return -1;
}

async function connection(port: i64, request: u8[], count: i64): Promise<Share> {
  let latencies: f64[] = [];
  try {
    const conn = await TcpStream.connect("127.0.0.1", port);
    let buf: u8[] = [];
    for (let i = 0; i < count; i++) {
      const start = performance.now();
      await conn.write(request.clone());
      let end = headEnd(buf);
      while (end < 0) {
        const got = await conn.read(65536);
        if (got.length === 0) return { latencies, error: "the server closed the connection" };
        buf = buf.concat(got);
        end = headEnd(buf);
      }
      const head = new TextDecoder().decode(buf.slice(0, end));
      if (!head.startsWith("HTTP/1.1 200")) return { latencies, error: `the server answered '${head.split("\r\n")[0]}'` };
      const length = contentLength(head);
      if (length < 0) return { latencies, error: "a response had no Content-Length" };
      while ((buf.length as i64) < end + length) {
        const got = await conn.read(65536);
        if (got.length === 0) return { latencies, error: "the server closed the connection" };
        buf = buf.concat(got);
      }
      buf = buf.slice(end + length);
      latencies.push((performance.now() - start) * 1000.0);
    }
  } catch (e) {
    return { latencies, error: e.message };
  }
  return { latencies, error: "" };
}

async function main(): Promise<void> throws IoError {
  const args = process.argv.slice(2);
  if (args.length < 4) {
    console.error("usage: load <port> <path> <connections> <requests> [<file whose text is POSTed>]");
    process.exit(2);
  }
  const port = parseInt(args[0]!) ?? 0;
  const path = args[1]!;
  const connections = parseInt(args[2]!) ?? 1;
  const requests = parseInt(args[3]!) ?? 1;
  const body = args.length > 4 ? readFileSync(args[4]!, "utf8") : "";
  const head = body === "" ? `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n` : `POST ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: ${new TextEncoder().encode(body).length}\r\n\r\n${body}`;
  const request = new TextEncoder().encode(head);
  const started = performance.now();
  let tasks: JoinHandle<Share>[] = [];
  for (let c = 0; c < connections; c++) tasks.push(spawn(connection(port, request.clone(), requests / connections)));
  let all: f64[] = [];
  let errors: string[] = [];
  while (tasks.length > 0) {
    const share = await tasks.pop()!;
    for (const l of share.latencies) all.push(l);
    if (share.error !== "") errors.push(share.error);
  }
  const seconds = (performance.now() - started) / 1000.0;
  all.sort((a, b) => a - b);
  const at = (p: f64): f64 => (all.length === 0 ? 0.0 : all[Math.min(all.length - 1, Math.floor((all.length as f64) * p) as usize)]);
  console.log(JSON.stringify({ requests: all.length, seconds, perSecond: (all.length as f64) / seconds, p50: at(0.5), p99: at(0.99), errors }));
}
