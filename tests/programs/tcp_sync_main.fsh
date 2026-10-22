// error: 'TcpListener.bind' works only when 'main' is an async function, whose runtime waits on sockets
function main() {
  const l = TcpListener.bind("127.0.0.1", 0);
}
