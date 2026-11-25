// The benchmark's HTTP service in Fish: a plain route, and one that reads and writes JSON.
//   server <port>
type Item = { sku: string, qty: i64, price: f64 };
type Order = { id: i64, customer: string, items: Item[] };

async function main(): Promise<void> throws IoError {
  let app = new Router();
  app.get("/hello", async (_req) => new Response("hello"));
  app.post("/order", async (req) => {
    try {
      const order = await req.json<Order>();
      let total = 0.0;
      for (const item of order.items) total += item.price * (item.qty as f64);
      return Response.json({ id: order.id, customer: order.customer, lines: order.items.length, total });
    } catch (_e) {
      return new Response("bad order", { status: 400 });
    }
  });
  const port = process.argv.length > 2 ? (parseInt(process.argv[2]) ?? 8791) : 8791;
  await serve({ port, hostname: "127.0.0.1" }, app.handler());
}
