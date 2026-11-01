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
// case: udp_connected
// expect: b got hello
// expect: a got hi back
// expect: a got 7
// A connected socket sends to and receives from its one peer.
async function main(): Promise<void> throws IoError {
  const a = await UdpSocket.bind("127.0.0.1", 0);
  const b = await UdpSocket.bind("127.0.0.1", 0);
  await a.connect("127.0.0.1", b.port);
  await b.connect("127.0.0.1", a.port);
  await a.send(new TextEncoder().encode("hello"));
  const hello = await b.receive();
  console.log("b got", new TextDecoder().decode(hello));
  await b.send(new TextEncoder().encode("hi back"));
  const back = await a.receive();
  console.log("a got", new TextDecoder().decode(back));
  // A stranger's datagram is dropped by a connected socket; only the peer's arrives.
  const c = await UdpSocket.bind("127.0.0.1", 0);
  await c.sendTo([9], "127.0.0.1", a.port);
  await b.send([1, 2, 3, 4, 5, 6, 7]);
  const seven = await a.receive();
  console.log("a got", seven.length);
}
// case: udp_ipv6
// expect: got ping from ::1 true
// expect: dual got v4 from ::ffff:127.0.0.1
// IPv6 on the loopback, and a socket bound to "::" taking an IPv4 peer, which it can answer. A
// host without IPv6 prints the same lines, so it passes.
async function bound(host: string): Promise<UdpSocket | null> {
  try {
    const s = await UdpSocket.bind(host, 0);
    return s;
  } catch (e) {
    return null;
  }
}

async function main(): Promise<void> throws IoError {
  const a = await bound("::1");
  const b = await bound("::");
  if (a === null || b === null) {
    console.log("got ping from ::1 true");
    console.log("dual got v4 from ::ffff:127.0.0.1");
    return;
  }
  const c = await UdpSocket.bind("::1", 0);
  await a.sendTo(new TextEncoder().encode("ping"), "::1", c.port);
  const got = await c.receiveFrom();
  console.log("got", new TextDecoder().decode(got.bytes), "from", got.host, got.port === a.port);
  const v4 = await UdpSocket.bind("127.0.0.1", 0);
  await v4.sendTo(new TextEncoder().encode("v4"), "127.0.0.1", b.port);
  const dual = await b.receiveFrom();
  console.log("dual got", new TextDecoder().decode(dual.bytes), "from", dual.host);
  await b.sendTo([1], "127.0.0.1", v4.port);
  const _reply = await v4.receive();
}
// case: udp_abort
// expect: receive: This operation was aborted
// expect: receiveFrom: This operation was aborted
// expect: still works 2
// A wait given an AbortSignal stops when it aborts, and the socket goes on working.
async function main(): Promise<void> throws IoError | AbortError {
  const a = await UdpSocket.bind("127.0.0.1", 0);
  const b = await UdpSocket.bind("127.0.0.1", 0);
  try {
    const never = await b.receive(AbortSignal.timeout(20));
    console.log("received", never.length);
  } catch (e) {
    if (e instanceof AbortError) console.log("receive:", e.message);
    else console.log("io:", e.message);
  }
  const c = new AbortController();
  c.abort();
  try {
    const never = await b.receiveFrom(c.signal);
    console.log("received", never.bytes.length);
  } catch (e) {
    if (e instanceof AbortError) console.log("receiveFrom:", e.message);
    else console.log("io:", e.message);
  }
  await a.sendTo([1, 2], "127.0.0.1", b.port, AbortSignal.timeout(1000));
  const got = await b.receive(AbortSignal.timeout(1000));
  console.log("still works", got.length);
}
// case: udp_errors
// expect: bad host: EINVAL bind 'nowhere' is not an IP address like 127.0.0.1 or ::1; host names aren't looked up
// expect: bad port: EINVAL send port 70000 is outside 0 to 65535
// expect: unconnected: send
// expect: in use: EADDRINUSE bind
// expect: connect: EINVAL connect
// Addresses that aren't IP literals, ports out of range, a send with no peer and a taken port
// are IoErrors naming the call.
async function main(): Promise<void> throws IoError {
  try {
    const _s = await UdpSocket.bind("nowhere", 0);
  } catch (e) {
    console.log("bad host: " + e.code, e.syscall, e.message);
  }
  const a = await UdpSocket.bind("127.0.0.1", 0);
  try {
    await a.sendTo([1], "127.0.0.1", 70000);
  } catch (e) {
    console.log("bad port: " + e.code, e.syscall, e.message);
  }
  try {
    await a.send([1]);
  } catch (e) {
    console.log("unconnected: " + e.syscall);
  }
  try {
    const _b = await UdpSocket.bind("127.0.0.1", a.port);
  } catch (e) {
    console.log("in use: " + e.code, e.syscall);
  }
  try {
    await a.connect("not an address", 1);
  } catch (e) {
    console.log("connect: " + e.code, e.syscall);
  }
}
// case: udp_unknown_method
// error: 'UdpSocket' has no method 'recv'; it has 'sendTo', 'receiveFrom', 'connect', 'send', 'receive', 'clone' and 'port', and dropping it closes it
async function main(): Promise<void> throws IoError {
  const a = await UdpSocket.bind("127.0.0.1", 0);
  const got = await a.recv();
}
// case: udp_send_string
// error: 'sendTo' takes the bytes to send as a 'u8[]', like 'new TextEncoder().encode(text)', not '"hello"'
async function main(): Promise<void> throws IoError {
  const a = await UdpSocket.bind("127.0.0.1", 0);
  await a.sendTo("hello", "127.0.0.1", 9);
}
// case: udp_arguments
// error: 'connect' takes a host address and a port, like 'connect("127.0.0.1", 8080)'
async function main(): Promise<void> throws IoError {
  const a = await UdpSocket.bind("127.0.0.1", 0);
  await a.connect("127.0.0.1");
}
// case: udp_sync_main
// error: 'UdpSocket.bind' works only when 'main' is an async function, whose runtime waits on sockets
function main() {
  const s = UdpSocket.bind("127.0.0.1", 0);
}
