// expect: true
// A write larger than the socket holds waits for room, and all of it arrives.
async function sink(listener: TcpListener, size: i64): Promise<i64> throws IoError {
  const conn = await listener.accept();
  let total: i64 = 0;
  let sum: i64 = 0;
  while (total < size) {
    const got = await conn.read(100000);
    if (got.length === 0) return -1;
    for (const b of got) sum += b as i64;
    total += got.length as i64;
  }
  return sum;
}
async function main(): Promise<void> throws IoError {
  const listener = await TcpListener.bind("127.0.0.1", 0);
  const size: i64 = 4000000;
  const h = spawn(sink(listener.clone(), size));
  const conn = await TcpStream.connect("127.0.0.1", listener.port);
  let bytes: u8[] = [];
  let want: i64 = 0;
  for (let i = 0; i < size; i++) { const v = (i % 251) as u8; bytes.push(v); want += i % 251; }
  await conn.write(bytes);
  const sum = await h;
  console.log(sum === want);
}
