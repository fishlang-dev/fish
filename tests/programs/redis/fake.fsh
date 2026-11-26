// A small Redis server for the test: strings, counters, lists by length, lifetimes, AUTH,
// and publish and subscribe, over RESP2.
type Store = { strings: Map<string, string>; lists: Map<string, i64>; ttls: Map<string, i64> };
type Subscribers = { channels: string[]; streams: TcpStream[] };
type Server = { store: Lock<Store>; subscribers: Lock<Subscribers> };

export async function fakeRedis(): Promise<i64> throws IoError {
  const listener = await TcpListener.bind("127.0.0.1", 0);
  const port = listener.port;
  const store: Store = { strings: new Map(), lists: new Map(), ttls: new Map() };
  const subscribers: Subscribers = { channels: [], streams: [] };
  const server = shared<Server>({ store: new Lock(store), subscribers: new Lock(subscribers) });
  spawn(accepting(listener, server));
  return port;
}

async function accepting(listener: TcpListener, server: shared<Server>): Promise<void> {
  while (true) {
    try {
      const conn = await listener.accept();
      spawn(serving(conn, server.clone()));
    } catch (e) {
      return;
    }
  }
}

// The next command's words, or null once the client has gone.
async function command(conn: Ref<TcpStream>, buffer: Mut<u8[]>): Promise<string[] | null> throws IoError | AbortError {
  while (true) {
    const words = parseCommand(buffer);
    if (words !== null) return words;
    const got = await conn.read(65536);
    if (got.length === 0) return null;
    for (const b of got) buffer.push(b);
  }
}

// A whole array of bulk strings at the buffer's start, taken out of it, or null when it hasn't all come.
function parseCommand(buffer: Mut<u8[]>): string[] | null {
  let at: i64 = 0;
  const head = lineAt(buffer, at);
  if (head === null) return null;
  const n = parseInt(head.text.slice(1)) ?? 0;
  at = head.next;
  let words: string[] = [];
  for (let i = 0; i < n; i++) {
    const size = lineAt(buffer, at);
    if (size === null) return null;
    const len = parseInt(size.text.slice(1)) ?? 0;
    if ((buffer.length as i64) < size.next + len + 2) return null;
    words.push(new TextDecoder().decode(buffer.slice(size.next, size.next + len)));
    at = size.next + len + 2;
  }
  const rest = buffer.splice(at);
  buffer.splice(0);
  for (const b of rest) buffer.push(b);
  return words;
}

function lineAt(b: Ref<u8[]>, at: i64): { text: string; next: i64 } | null {
  for (let i = at; i + 1 < (b.length as i64); i++) {
    if (b[i as usize] === 13 && b[(i + 1) as usize] === 10) return { text: new TextDecoder().decode(b.slice(at, i)), next: i + 2 };
  }
  return null;
}

function bulk(s: string): string {
  return "$" + String(new TextEncoder().encode(s).length as i64) + "\r\n" + s + "\r\n";
}

function integer(n: i64): string {
  return ":" + String(n) + "\r\n";
}

async function serving(conn: TcpStream, server: shared<Server>): Promise<void> {
  let buffer: u8[] = [];
  try {
    while (true) {
      const words = await command(conn, buffer);
      if (words === null) return;
      const name = words[0].toUpperCase();
      if (name === "SUBSCRIBE") {
        for (let i: usize = 1; i < words.length; i++) {
          const channel = words[i];
          const stream = conn.clone();
          const count = server.subscribers.update((s) => {
            s.channels.push(channel);
            s.streams.push(stream);
            return s.channels.length as i64;
          });
          await conn.write(new TextEncoder().encode("*3\r\n" + bulk("subscribe") + bulk(channel) + integer(count)));
        }
        continue;
      }
      if (name === "PUBLISH") {
        const channel = words[1];
        const text = "*3\r\n" + bulk("message") + bulk(channel) + bulk(words[2]);
        const targets = server.subscribers.update((s) => {
          let out: TcpStream[] = [];
          for (let i: usize = 0; i < s.channels.length; i++) if (s.channels[i] === channel) out.push(s.streams[i].clone());
          return out;
        });
        for (const t of targets) await t.write(new TextEncoder().encode(text));
        await conn.write(new TextEncoder().encode(integer(targets.length as i64)));
        continue;
      }
      const reply = server.store.update((s) => answer(s, words));
      await conn.write(new TextEncoder().encode(reply));
    }
  } catch (e) {
    return;
  }
}

const WRONGTYPE = "-WRONGTYPE Operation against a key holding the wrong kind of value\r\n";

function answer(s: Mut<Store>, words: Ref<string[]>): string {
  const name = words[0].toUpperCase();
  if (name === "PING") return "+PONG\r\n";
  if (name === "AUTH") return words[words.length - 1] === "secret" ? "+OK\r\n" : "-WRONGPASS invalid username-password pair\r\n";
  if (name === "SELECT") return "+OK\r\n";
  if (name === "GET") {
    if (s.lists.has(words[1])) return WRONGTYPE;
    const v = s.strings.get(words[1]);
    return v === null ? "$-1\r\n" : bulk(v);
  }
  if (name === "SET") {
    const there = s.strings.has(words[1]);
    let i: usize = 3;
    let ttl: i64 = -1;
    while (i < words.length) {
      const o = words[i].toUpperCase();
      if (o === "NX" && there) return "$-1\r\n";
      if (o === "XX" && !there) return "$-1\r\n";
      if (o === "EX") {
        ttl = parseInt(words[i + 1]) ?? 0;
        i += 1;
      }
      if (o === "PX") {
        ttl = (parseInt(words[i + 1]) ?? 0) / 1000;
        i += 1;
      }
      i += 1;
    }
    s.strings.set(words[1], words[2]);
    if (ttl >= 0) s.ttls.set(words[1], ttl);
    else s.ttls.delete(words[1]);
    return "+OK\r\n";
  }
  if (name === "INCR" || name === "INCRBY" || name === "DECR") {
    if (s.lists.has(words[1])) return WRONGTYPE;
    const by = name === "INCRBY" ? parseInt(words[2]) ?? 0 : name === "DECR" ? -1 : 1;
    const now = (parseInt(s.strings.get(words[1]) ?? "0") ?? 0) + by;
    s.strings.set(words[1], String(now));
    return integer(now);
  }
  if (name === "DEL") {
    let n: i64 = 0;
    for (let i: usize = 1; i < words.length; i++) {
      if (s.strings.delete(words[i]) || s.lists.delete(words[i])) n++;
      s.ttls.delete(words[i]);
    }
    return integer(n);
  }
  if (name === "EXISTS") return integer(s.strings.has(words[1]) || s.lists.has(words[1]) ? 1 : 0);
  if (name === "EXPIRE") {
    if (!s.strings.has(words[1]) && !s.lists.has(words[1])) return integer(0);
    s.ttls.set(words[1], parseInt(words[2]) ?? 0);
    return integer(1);
  }
  if (name === "TTL") {
    if (!s.strings.has(words[1]) && !s.lists.has(words[1])) return integer(-2);
    return integer(s.ttls.get(words[1]) ?? -1);
  }
  if (name === "RPUSH") {
    const n = (s.lists.get(words[1]) ?? 0) + (words.length as i64) - 2;
    s.lists.set(words[1], n);
    return integer(n);
  }
  return "-ERR unknown command '" + words[0] + "'\r\n";
}
