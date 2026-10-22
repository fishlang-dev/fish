// error: 'write' takes the bytes to send as a 'u8[]', like 'new TextEncoder().encode(text)', not '"hello"'
async function main(): Promise<void> throws IoError {
  const listener = await TcpListener.bind("127.0.0.1", 0);
  const conn = await TcpStream.connect("127.0.0.1", listener.port);
  await conn.write("hello");
}
