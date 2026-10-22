// expect: text/html a=1, b=2 false none
// expect: false
// expect: content-type=text/html;
// expect: POST http://localhost:8080/users/7?full=1#top /users/7 hello false
// expect: GET /x false
// expect: 201 true text/plain;charset=UTF-8 true
// expect: hi
// expect: 404 false false 0
// expect: 200
// The Fetch API's Headers, Request and Response, from the std HTTP library.
async function main(): Promise<void> {
  let h = new Headers();
  h.set("Content-Type", "text/html");
  h.append("Set-Cookie", "a=1");
  h.append("set-cookie", "b=2");
  console.log(h.get("content-type"), h.get("SET-COOKIE"), h.has("x"), h.get("x") ?? "none");
  h.delete("Set-Cookie");
  console.log(h.has("set-cookie"));
  let names = "";
  h.forEach((value: string, name: string) => { names = names + name + "=" + value + ";"; });
  console.log(names);
  const req = new Request("http://localhost:8080/users/7?full=1#top", { method: "post", body: "hello" });
  const body = await req.text();
  console.log(req.method, req.url, req.path, body, req.signal.aborted);
  const plain = new Request("/x");
  console.log(plain.method, plain.path, plain.headers.has("a"));
  const res = new Response("hi", { status: 201 });
  console.log(res.status, res.ok, res.headers.get("content-type"), res.statusText === "");
  const text = await res.text();
  console.log(text);
  const empty = new Response(null, { status: 404 });
  console.log(empty.status, empty.ok, empty.headers.has("content-type"), empty.body.length);
  const bare = new Response();
  console.log(bare.status);
}
