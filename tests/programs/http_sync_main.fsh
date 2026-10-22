// expect: text/plain;charset=UTF-8 x
// Request, Response and Headers work in a program whose main isn't async.
function main() {
  let h = new Headers();
  h.set("x", "x");
  const res = new Response("hi", { headers: h });
  console.log(res.headers.get("content-type") ?? "", res.headers.get("x") ?? "");
}
