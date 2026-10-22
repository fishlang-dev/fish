// expect: 'read' needs room for at least 1 byte, not 0
async function main(): Promise<void> throws IoError {
  const listener = await TcpListener.bind("127.0.0.1", 0);
  const conn = await TcpStream.connect("127.0.0.1", listener.port);
  try {
    const got = await conn.read(0);
  } catch (e) {
    console.log(e.message);
  }
}
