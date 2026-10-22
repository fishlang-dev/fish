// expect: 1 2 3
// expect: 0
// Names that only look like the HTTP library's, in a program with a sync main, leave it out.
class Server {
  serve(): i64 { return 1; }
}
type T = { Response: i64 };
function main() {
  const o = { serve: 2 };
  const t: T = { Response: 3 };
  console.log(new Server().serve(), o.serve, t.Response);
  const Headers = 0;
  console.log(Headers);
}
