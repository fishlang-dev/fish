// case: cors_allowed_origin
// expect: * * - a.com
// expect: - https://a.com https://a.com -
// The origin a request gets: any for "*", echoed for "*" with credentials, and only listed ones
// otherwise.
import { allowedOrigin } from "std:cors";
function shown(s: string): string {
  return s === "" ? "-" : s;
}

function main() {
  const any = ["*"];
  const listed = ["https://a.com", "https://b.com"];
  console.log(allowedOrigin(any, "https://x.com", false), allowedOrigin(any, "", false), shown(allowedOrigin(any, "", true)), allowedOrigin(any, "a.com", true));
  console.log(shown(allowedOrigin(listed, "https://x.com", false)), allowedOrigin(listed, "https://a.com", false), allowedOrigin(listed, "https://a.com", true), shown(allowedOrigin(listed, "https://A.com", false)));
}
// case: cors_any
// expect: GET 200 origin=* methods=- credentials=- vary=- [hello]
// expect: OPTIONS 204 origin=* methods=GET, HEAD, PUT, POST, DELETE, PATCH credentials=- vary=- []
// expect: GET 404 origin=* methods=- credentials=- vary=- [Not Found]
// expect: route ran 1
// With no options any origin is allowed; a preflight is answered without running the route, and
// the router's 404 carries the headers too.
import { cors } from "std:cors";
async function show(app: Ref<Router>, method: string, path: string, preflight: boolean): Promise<void> {
  let headers = new Headers();
  headers.set("origin", "https://x.com");
  if (preflight) headers.set("access-control-request-method", "PUT");
  const res = await app.handle(new Request("http://h" + path, { method: method, headers: headers }));
  const body = await res.text();
  const h = res.headers;
  console.log(method, res.status, "origin=" + (h.get("access-control-allow-origin") ?? "-"), "methods=" + (h.get("access-control-allow-methods") ?? "-"), "credentials=" + (h.get("access-control-allow-credentials") ?? "-"), "vary=" + (h.get("vary") ?? "-"), "[" + body.trim() + "]");
}

async function main(): Promise<void> {
  const ran = shared({ n: new Atomic(0) });
  const seen = ran.clone();
  let app = new Router();
  app.use(cors());
  app.get("/hello", async (_req) => {
    seen.n.add(1);
    return new Response("hello");
  });
  await show(app, "GET", "/hello", false);
  await show(app, "OPTIONS", "/hello", true);
  await show(app, "GET", "/nowhere", false);
  console.log("route ran", ran.n.load());
}
// case: cors_listed
// expect: https://a.com 200 origin=https://a.com credentials=true vary=Accept, Origin
// expect: https://evil.com 200 origin=- credentials=- vary=Accept, Origin
// expect: preflight https://a.com 204 origin=https://a.com methods=GET, POST headers=content-type, x-token credentials=true vary=Origin
// expect: preflight https://evil.com 204 origin=- methods=- headers=- credentials=- vary=Origin
// expect: plain OPTIONS 204 allow=GET, HEAD, OPTIONS origin=https://a.com
// Listed origins with credentials: a listed origin is echoed with credentials, another gets no
// CORS headers, Vary names Origin beside what the route set, and an OPTIONS that isn't a
// preflight goes on to the router.
import { cors } from "std:cors";
async function ask(app: Ref<Router>, method: string, origin: string, preflight: boolean): Promise<Response> {
  let headers = new Headers();
  headers.set("origin", origin);
  if (preflight) {
    headers.set("access-control-request-method", "POST");
    headers.set("access-control-request-headers", "content-type, x-token");
  }
  const res = await app.handle(new Request("http://h/data", { method: method, headers: headers }));
  return res;
}

function got(res: Ref<Response>, name: string): string {
  return res.headers.get(name) ?? "-";
}

async function main(): Promise<void> {
  let app = new Router();
  app.use(cors({ origins: ["https://a.com"], methods: ["GET", "POST"], credentials: true }));
  app.get("/data", async (_req) => {
    let res = new Response("data");
    res.headers.set("vary", "Accept");
    return res;
  });
  for (const origin of ["https://a.com", "https://evil.com"]) {
    const res = await ask(app, "GET", origin, false);
    console.log(origin, res.status, "origin=" + got(res, "access-control-allow-origin"), "credentials=" + got(res, "access-control-allow-credentials"), "vary=" + got(res, "vary"));
  }
  for (const origin of ["https://a.com", "https://evil.com"]) {
    const res = await ask(app, "OPTIONS", origin, true);
    console.log("preflight", origin, res.status, "origin=" + got(res, "access-control-allow-origin"), "methods=" + got(res, "access-control-allow-methods"), "headers=" + got(res, "access-control-allow-headers"), "credentials=" + got(res, "access-control-allow-credentials"), "vary=" + got(res, "vary"));
  }
  const plain = await ask(app, "OPTIONS", "https://a.com", false);
  console.log("plain OPTIONS", plain.status, "allow=" + got(plain, "allow"), "origin=" + got(plain, "access-control-allow-origin"));
}
