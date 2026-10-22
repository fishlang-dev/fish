// error: 'bind' can't run while compiling: comptime code only computes values
// A top-level const needing run-time work, like a socket, is refused, naming it.
const L = TcpListener.bind("127.0.0.1", 0);
async function main(): Promise<void> {}
