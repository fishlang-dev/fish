// case: websocket_handshake
// expect: 101 websocket s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
// expect: 426 websocket
// expect: 426 13
// expect: 400
// expect: 404
// A WebSocket route answers the upgrade with RFC 6455's accept key, and refuses a request that
// isn't one. It is a GET route, so another method finds no route.
function upgrade(version: string, key: string): Headers {
  let h = new Headers();
  h.set("upgrade", "websocket");
  h.set("connection", "keep-alive, Upgrade");
  h.set("sec-websocket-version", version);
  h.set("sec-websocket-key", key);
  return h;
}
async function main(): Promise<void> {
  let app = new Router();
  app.ws("/chat", async (ws, _req) => {
    for await (const m of ws) ws.send(m);
  });
  const ok = await app.handle(new Request("http://h/chat", { headers: upgrade("13", "dGhlIHNhbXBsZSBub25jZQ==") }));
  console.log(ok.status, ok.headers.get("upgrade"), ok.headers.get("sec-websocket-accept"));
  const plain = await app.handle(new Request("http://h/chat"));
  console.log(plain.status, plain.headers.get("upgrade"));
  const old = await app.handle(new Request("http://h/chat", { headers: upgrade("8", "dGhlIHNhbXBsZSBub25jZQ==") }));
  console.log(old.status, old.headers.get("sec-websocket-version"));
  const bad = await app.handle(new Request("http://h/chat", { headers: upgrade("13", "not-a-key") }));
  console.log(bad.status);
  const post = await app.handle(new Request("http://h/chat", { method: "POST", headers: upgrade("13", "dGhlIHNhbXBsZSBub25jZQ==") }));
  console.log(post.status);
}
// case: websocket_messages_typed
// expect: ok
// A message is text or bytes, told apart with typeof.
async function main(): Promise<void> {
  let app = new Router();
  app.ws("/", async (ws: ServerWebSocket, _req: Request) => {
    for await (const m of ws) {
      if (typeof m === "string") ws.send(m.toUpperCase());
      else ws.send(String(m.length) + " bytes");
    }
  });
  console.log("ok");
}
// case: websocket_send_number
// error: argument of type 'usize' is not assignable to parameter of type 'string | u8[]'
async function main(): Promise<void> {
  let app = new Router();
  app.ws("/", async (ws, _req) => {
    for await (const m of ws) {
      if (typeof m !== "string") ws.send(m.length);
    }
  });
}
