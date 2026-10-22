// expect: 7
// expect: 20 x
// expect: 200 hi / x
async function twice(f: (n: i64) => Promise<i64>, start: i64): Promise<i64> {
  const a = await f(start);
  const b = await f(a);
  return b;
}
class Headers {
  names: string[] = [];
  values: string[] = [];
  get(name: string): string | null {
    const lower = name.toLowerCase();
    for (let i = 0; i < this.names.length; i++) {
      if (this.names[i] === lower) return this.values[i];
    }
    return null;
  }
  set(this: Mut<this>, name: string, value: string) {
    this.names.push(name.toLowerCase());
    this.values.push(value);
  }
}
class Request { method: string; path: string; headers: Headers; constructor(method: string, path: string, headers: Headers) { this.method = method; this.path = path; this.headers = headers; } }
class Response { status: i64; body: string; constructor(body: string, status: i64) { this.body = body; this.status = status; } }
type Options = { port: i64 };
async function run(options: Options, handler: (req: Request) => Promise<Response>): Promise<void> {
  let h = new Headers();
  h.set("Host", "x");
  const req = new Request("GET", "/", h);
  const res = await handler(req);
  console.log(res.status, res.body);
}

// Awaiting a call of a function-typed parameter gives what the closure it was given gives.
async function main(): Promise<void> {
  const step = 3;
  const label = "x";
  const t = await twice(async (n: i64) => n + step, 1);
  console.log(t);
  const s = await twice(async (n: i64) => { await yieldNow(); return n * 2; }, 5);
  console.log(s, label);
  await run({ port: 8 }, async (req: Request) => new Response(`hi ${req.path} ${req.headers.get("HOST") ?? "none"}`, 200));
}
