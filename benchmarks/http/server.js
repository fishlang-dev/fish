// The benchmark's HTTP service on Node's http module, as server.fsh serves it.
//   node server.js <port>
const http = require("node:http");

function send(res, status, type, body) {
  res.writeHead(status, { "content-type": type, "content-length": Buffer.byteLength(body) });
  res.end(body);
}

http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/hello") return send(res, 200, "text/plain", "hello");
  if (req.method === "POST" && req.url === "/order") {
    let text = "";
    req.on("data", (chunk) => { text += chunk; });
    req.on("end", () => {
      try {
        const order = JSON.parse(text);
        let total = 0;
        for (const item of order.items) total += item.price * item.qty;
        send(res, 200, "application/json", JSON.stringify({ customer: order.customer, id: order.id, lines: order.items.length, total }));
      } catch {
        send(res, 400, "text/plain", "bad order");
      }
    });
    return;
  }
  send(res, 404, "text/plain", "not found");
}).listen(Number(process.argv[2] ?? 8791), "127.0.0.1");
