// expect: 'nowhere' is not an IP address like 127.0.0.1; host names aren't looked up
// expect: can't listen there: Address already in use
// expect: port 70000 is outside 0 to 65535
async function main(): Promise<void> throws IoError {
  try {
    const l = await TcpListener.bind("nowhere", 0);
    console.log("bound");
  } catch (e) {
    console.log(e.message);
  }
  const first = await TcpListener.bind("127.0.0.1", 0);
  try {
    const again = await TcpListener.bind("127.0.0.1", first.port);
    console.log("bound twice");
  } catch (e) {
    console.log(e.message);
  }
  try {
    const c = await TcpStream.connect("127.0.0.1", 70000);
  } catch (e) {
    console.log(e.message);
  }
}
