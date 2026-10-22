// expect: 200 user 7 posts
// expect: 201 made
// expect: 200 user 9 posts
// expect: 404 Not Found
// expect: 404 Not Found
// expect: 404 Not Found
// expect: 200 first
// expect: 200 any PUT
// expect: 200 deleted 3
// expect: 200 empty
// A Router picks the first route matching a request's method and path, reads its :params,
// runs GET routes for HEAD, and gives 404 for the rest.
async function show(app: Ref<Router>, method: string, url: string): Promise<void> {
  const res = await app.handle(new Request(url, { method: method }));
  const body = await res.text();
  console.log(res.status, body.trim());
}

async function main(): Promise<void> {
  let app = new Router();
  app.get("/users/:id/:what", async (req) => new Response("user " + req.param("id") + " " + req.param("what")));
  app.post("/users", async (req) => new Response("made", { status: 201 }));
  app.get("/twice", async (req) => new Response("first"));
  app.get("/twice", async (req) => new Response("second"));
  app.all("/any", async (req) => new Response("any " + req.method));
  app.delete("/items/:n", async (req) => new Response("deleted " + req.param("n")));
  app.get("/empty", async (req) => new Response(req.param("nope") === "" ? "empty" : "?"));
  await show(app, "GET", "http://h/users/7/posts");
  await show(app, "POST", "http://h/users");
  await show(app, "HEAD", "http://h/users/9/posts");
  await show(app, "GET", "http://h/users");
  await show(app, "POST", "http://h/users/7/posts");
  await show(app, "GET", "http://h/users//posts");
  await show(app, "GET", "http://h/twice");
  await show(app, "PUT", "http://h/any");
  await show(app, "DELETE", "http://h/items/3");
  await show(app, "GET", "http://h/empty");
}
