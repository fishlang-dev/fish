// expect: no slash|ok
// expect: lowercase method|ok
// expect: head route|head
// expect: head falls back|get
// expect: repeated param|2
// expect: query and fragment|a
// expect: trailing slash|Not Found
// Router edges: paths without a leading '/', methods in any case, HEAD routes, repeated
// :params, queries and trailing slashes.
async function show(app: Ref<Router>, label: string, method: string, url: string): Promise<void> {
  const res = await app.handle(new Request(url, { method: method }));
  const body = await res.text();
  console.log(label + "|" + body.trim());
}

async function main(): Promise<void> {
  let app = new Router();
  app.get("noslash", async (req) => new Response("ok"));
  app.route("post", "/lower", async (req) => new Response("ok"));
  app.get("/h", async (req) => new Response("get"));
  app.route("HEAD", "/h", async (req) => new Response("head"));
  app.get("/g", async (req) => new Response("get"));
  app.get("/a/:id/b/:id", async (req) => new Response(req.param("id")));
  app.get("/q/:x", async (req) => new Response(req.param("x")));
  app.get("/users", async (req) => new Response("users"));
  await show(app, "no slash", "GET", "http://h/noslash");
  await show(app, "lowercase method", "POST", "http://h/lower");
  await show(app, "head route", "HEAD", "http://h/h");
  await show(app, "head falls back", "HEAD", "http://h/g");
  await show(app, "repeated param", "GET", "http://h/a/1/b/2");
  await show(app, "query and fragment", "GET", "http://h/q/a?b=/c#d");
  await show(app, "trailing slash", "GET", "http://h/users/");
}
