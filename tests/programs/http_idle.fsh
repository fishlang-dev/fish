// expect: closed after idling
// A connection that sends nothing is closed after 5 seconds.
async function main(): Promise<void> throws IoError {
  const found = shared({ port: new Atomic(0) });
  const seen = found.clone();
  spawn(serve({ port: 0, hostname: "127.0.0.1", onListen: (info: ServeInfo) => { seen.port.store(info.port); } }, async (req: Request) => new Response("hi")));
  while (found.port.load() === 0) await sleep(1);
  const conn = await TcpStream.connect("127.0.0.1", found.port.load());
  try {
    const got = await conn.read(16, AbortSignal.timeout(8000));
    if (got.length === 0) console.log("closed after idling");
  } catch (e) {
    console.log("still open after 8 seconds");
  }
}
