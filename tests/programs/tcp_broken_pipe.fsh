// expect: write failed true
// expect: still running
// Writing to a peer that has gone throws an IoError rather than ending the program.
async function main(): Promise<void> throws IoError {
  const listener = await TcpListener.bind("127.0.0.1", 0);
  const conn = await TcpStream.connect("127.0.0.1", listener.port);
  {
    const server = await listener.accept();
  }
  await sleep(20);
  try {
    for (let i = 0; i < 100; i++) {
      let b: u8[] = [];
      for (let j = 0; j < 100000; j++) b.push(7);
      await conn.write(b);
    }
    console.log("wrote all");
  } catch (e) {
    console.log("write failed", e.message.startsWith("can't write"));
  }
  try {
    const got = await conn.read(10);
  } catch (e) {
  }
  console.log("still running");
}
