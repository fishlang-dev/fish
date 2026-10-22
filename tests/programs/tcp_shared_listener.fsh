// expect: 20
// Two tasks accepting on one listener, cloned: each is woken in turn.
async function serve(listener: TcpListener, n: i64): Promise<i64> throws IoError {
  for (let i = 0; i < n; i++) {
    const conn = await listener.accept();
  }
  return n;
}
async function main(): Promise<void> throws IoError {
  const listener = await TcpListener.bind("127.0.0.1", 0);
  const port = listener.port;
  const a = spawn(serve(listener.clone(), 10));
  const b = spawn(serve(listener, 10));
  for (let i = 0; i < 20; i++) {
    const c = await TcpStream.connect("127.0.0.1", port);
  }
  const x = await a;
  const y = await b;
  console.log(x + y);
}
