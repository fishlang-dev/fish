// case: udp_exchange
// expect: b got ping from 127.0.0.1 true
// expect: a got pong true
// expect: ports differ true
// Two sockets send datagrams both ways, each reply going back to the address it came from.
async function main(): Promise<void> throws IoError {
  const a: UdpSocket = await UdpSocket.bind("127.0.0.1", 0);
  const b = await UdpSocket.bind("127.0.0.1", 0);
  await a.sendTo(new TextEncoder().encode("ping"), "127.0.0.1", b.port);
  const got = await b.receiveFrom();
  console.log("b got", new TextDecoder().decode(got.bytes), "from", got.host, got.port === a.port);
  await b.sendTo(new TextEncoder().encode("pong"), got.host, got.port);
  const back = await a.receiveFrom();
  console.log("a got", new TextDecoder().decode(back.bytes), back.port === b.port);
  console.log("ports differ", a.port !== b.port && a.port > 0);
}
// case: udp_sizes
// expect: empty 0
// expect: large 60000 true
// expect: after 3
// An empty datagram arrives as one of zero bytes, and a large one whole.
async function main(): Promise<void> throws IoError {
  const a = await UdpSocket.bind("127.0.0.1", 0);
  const b = await UdpSocket.bind("127.0.0.1", 0);
  await a.sendTo([], "127.0.0.1", b.port);
  const empty = await b.receiveFrom();
  console.log("empty", empty.bytes.length);
  let big: u8[] = [];
  for (let i = 0; i < 60000; i++) big.push((i % 251) as u8);
  await a.sendTo(big.clone(), "127.0.0.1", b.port);
  const large = await b.receiveFrom();
  const got = large.bytes;
  let same = got.length === big.length;
  for (let i = 0; same && i < got.length; i++) same = got[i] === big[i];
  console.log("large", got.length, same);
  await a.sendTo([1, 2, 3], "127.0.0.1", b.port);
  const after = await b.receiveFrom();
  console.log("after", after.bytes.length);
}
// case: udp_waits
// expect: tick 0
// expect: tick 1
// expect: tick 2
// expect: received late
// A receive waits without holding up other tasks, and a clone sends on the same socket.
async function ticks(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    console.log("tick", i);
    await sleep(10);
  }
}

async function late(socket: UdpSocket, port: i64): Promise<void> throws IoError {
  await sleep(50);
  await socket.sendTo(new TextEncoder().encode("late"), "127.0.0.1", port);
}

async function main(): Promise<void> throws IoError {
  const a = await UdpSocket.bind("127.0.0.1", 0);
  const b = await UdpSocket.bind("127.0.0.1", 0);
  const t = spawn(ticks());
  const s = spawn(late(a.clone(), b.port));
  const got = await b.receiveFrom();
  await t;
  await s;
  console.log("received", new TextDecoder().decode(got.bytes));
}
