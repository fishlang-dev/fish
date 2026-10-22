// error: 'TcpListener.bind' needs the async runtime's reactor, which runs when 'main' is an async function
function main() {
  const l = TcpListener.bind("127.0.0.1", 0);
}
