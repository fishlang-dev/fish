// expect: main done
// Tasks still waiting on sockets when main ends are dropped with them, leaking nothing.
async function reader(listener: TcpListener): Promise<void> throws IoError {
  const conn = await listener.accept();
  const got = await conn.read(10);
  console.log("never", got.length);
}

async function acceptor(listener: TcpListener): Promise<void> throws IoError {
  const conn = await listener.accept();
  console.log("never");
}

async function hold(conn: TcpStream): Promise<void> {
  await sleep(100000);
}

async function main(): Promise<void> throws IoError {
  const first = await TcpListener.bind("127.0.0.1", 0);
  const port = first.port;
  const second = await TcpListener.bind("127.0.0.1", 0);
  spawn(reader(first));
  spawn(acceptor(second));
  const conn = await TcpStream.connect("127.0.0.1", port);
  spawn(hold(conn));
  await sleep(20);
  console.log("main done");
}
