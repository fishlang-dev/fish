// expect: 4000000 true
// One task reads a socket while another writes it, through a clone of the stream.
async function echo(listener: TcpListener): Promise<void> throws IoError {
  const conn = await listener.accept();
  while (true) {
    const got = await conn.read(65536);
    if (got.length === 0) return;
    await conn.write(got);
  }
}
async function writer(conn: TcpStream, size: i64): Promise<void> throws IoError {
  let bytes: u8[] = [];
  for (let i = 0; i < size; i++) bytes.push((i % 251) as u8);
  await conn.write(bytes);
}
async function main(): Promise<void> throws IoError {
  const listener = await TcpListener.bind("127.0.0.1", 0);
  const size: i64 = 4000000;
  const e = spawn(echo(listener.clone()));
  const conn = await TcpStream.connect("127.0.0.1", listener.port);
  const w = spawn(writer(conn.clone(), size));
  let total: i64 = 0;
  let ok = true;
  while (total < size) {
    const got = await conn.read(65536);
    if (got.length === 0) break;
    for (const b of got) { if ((b as i64) !== (total % 251)) ok = false; total++; }
  }
  await w;
  console.log(total, ok);
}
