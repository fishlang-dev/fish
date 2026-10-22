// expect: accepted 50 50
// expect: refused true
async function serve(listener: TcpListener, n: i64): Promise<i64> throws IoError {
  let count = 0;
  for (let i = 0; i < n; i++) {
    const conn = await listener.accept();
    count++;
  }
  return count;
}

async function dial(port: i64): Promise<i64> {
  try {
    const conn = await TcpStream.connect("127.0.0.1", port);
    return 1;
  } catch (e) {
    return 0;
  }
}

async function main(): Promise<void> throws IoError {
  const listener = await TcpListener.bind("127.0.0.1", 0);
  const port = listener.port;
  const server = spawn(serve(listener, 50));
  let handles: JoinHandle<i64>[] = [];
  for (let i = 0; i < 50; i++) handles.push(spawn(dial(port)));
  let clients: i64 = 0;
  while (handles.length > 0) {
    const h = handles.pop()!;
    const one = await h;
    clients += one;
  }
  const accepted = await server;
  console.log("accepted", accepted, clients);
  // A port nothing listens on any more: bound, then closed as the block ends.
  let free: i64 = 0;
  {
    const closed = await TcpListener.bind("127.0.0.1", 0);
    free = closed.port;
  }
  try {
    const conn = await TcpStream.connect("127.0.0.1", free);
    console.log("refused", false);
  } catch (e) {
    console.log("refused", e.message.startsWith("can't connect"));
  }
}
