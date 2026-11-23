// Typed routes: the route table a check fills in, and the OpenAPI document made from it.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyze, indented } from "../../src/main.fsh";
import { openapiOf } from "../../src/openapi.fsh";
import { cachedSession } from "../../src/stdcache.fsh";
import { removed, same, scratch } from "./support.fsh";

// The routes a check of `src` records, in the order they are written, each as a line.
function routesOf(src: string): string {
  const dir = scratch("fish-openapi-");
  let found: { start: usize; line: string }[] = [];
  try {
    const file = join(dir, "main.fsh");
    writeFileSync(file, src);
    const made = analyze(cachedSession(), src, file);
    for (const [node, r] of [...made.checked.tables.routes]) {
      const on = r.router === undefined ? "?" : made.checked.tables.arenas.localOf(r.router!).name;
      const child = r.child === undefined ? "?" : made.checked.tables.arenas.localOf(r.child!).name;
      const body = r.body === undefined ? "-" : made.checked.tables.typing.show(r.body!);
      const response = r.response === undefined ? "-" : made.checked.tables.typing.show(r.response!);
      const line = r.mount ? `mount ${r.path ?? "?"} on ${on}: ${child}` : `${r.method ?? "?"} ${r.path ?? "?"} on ${on}: ${body} -> ${response}`;
      found.push({ start: node.start, line });
    }
  } catch (e) {
    assert(false, `the check failed: ${e.message}`);
  }
  removed(dir);
  found.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  return found.map((f) => f.line).join("\n");
}

test("a check records the routes an openapi document is made from: typed, untyped and mounted", () => {
  const src = `async function main(): Promise<void> {
  let api = new Router();
  api.post("/users", async (_req, body: string[]): Promise<boolean> => body.length > 0);
  api.get("/users/:id", async (req) => new Response("user " + req.param("id")));
  api.all("/health", async (_req): Promise<boolean> => true);
  let app = new Router();
  app.route("/api", api);
  app.route("delete", "/sessions", async (_req): Promise<void> => {});
  const path = "/computed";
  app.get(path, async (_req) => new Response("x"));
  const res = await app.handle(new Request("http://h/api/health"));
  console.log(res.status);
}
`;
  same(routesOf(src), `POST /users on api: string[] -> boolean
GET /users/:id on api: - -> -
ALL /health on api: - -> boolean
mount /api on app: api
DELETE /sessions on app: - -> void
GET ? on app: - -> -`, "the routes");
}, { timeout: 60_000 });

// The document of `src`'s routes laid out as `fishc openapi` prints it, and the routes it
// leaves out, each as its call's text and why.
function documented(src: string): { document: string; left: string[] } {
  const dir = scratch("fish-openapi-");
  let out: { document: string; left: string[] } = { document: "", left: [] };
  try {
    const file = join(dir, "main.fsh");
    writeFileSync(file, src);
    const made = analyze(cachedSession(), src, file);
    const got = openapiOf(made.checked.tables, "shop", "1.2.0");
    out.document = indented(got.document);
    for (const l of got.left) out.left.push(`${src.slice(l.start as i64, l.end as i64)}: ${l.why}`);
  } catch (e) {
    assert(false, `the check failed: ${e.message}`);
  }
  removed(dir);
  return out;
}

// A document titled as `documented` titles one, of `paths` and the schemas kept by name.
function document(paths: string, schemas: string = ""): string {
  return indented(`{"openapi":"3.1.0","info":{"title":"shop","version":"1.2.0"},"paths":{${paths}}${schemas === "" ? "" : `,"components":{"schemas":{${schemas}}}`}}`);
}

// The responses of a handler answering with `schema`, of one that reads a body, and of one that
// says nothing of what it answers with.
function ok(schema: string): string {
  return `"200":{"description":"OK","content":{"application/json":{"schema":${schema}}}}`;
}
const REFUSED = `"400":{"description":"Bad Request","content":{"text/plain":{"schema":{"type":"string"}}}}`;
const UNTYPED = `"responses":{"default":{"description":"the handler's own response"}}`;

// A program whose main adds `routes` to a router `app`, after `declarations`.
function program(declarations: string, routes: string): string {
  return `${declarations}async function main(): Promise<void> {
  let app = new Router();
${routes}  const res = await app.handle(new Request("http://h/"));
  console.log(res.status);
}
`;
}

test("an openapi schema describes an object as JSON writes it: numbers, optional fields, literals and a C-like enum", () => {
  const made = documented(program(`enum Color { Red, Green }
type NewItem = { price: f64; note?: string };
type Item = { id: u32; price: f64; note?: string; color: Color; size: "s" | "m"; live: boolean };
`, `  app.post("/items", async (_req, body: NewItem): Promise<Item> => ({ id: 1, price: body.price, color: Color.Red, size: "s", live: true }));
`));
  const taken = `{"type":"object","properties":{"note":{"type":"string"},"price":{"type":"number"}},"required":["price"]}`;
  const given = `{"type":"object","properties":{"color":{"enum":[0,1]},"id":{"type":"integer"},"live":{"type":"boolean"},"note":{"type":"string"},"price":{"type":"number"},"size":{"enum":["m","s"]}},"required":["color","id","live","price","size"]}`;
  same(made.document, document(`"/items":{"post":{"requestBody":{"required":true,"content":{"application/json":{"schema":${taken}}}},"responses":{${ok(given)},${REFUSED}}}}`), "the document");
  same(made.left.join("\n"), "", "the routes left out");
}, { timeout: 60_000 });

test("an openapi schema describes arrays, tuples, a value or null, and a Map with string keys", () => {
  const made = documented(program("", `  app.get("/names", async (_req): Promise<string[]> => ["a"]);
  app.get("/pair", async (_req): Promise<[i64, string]> => [1, "a"]);
  app.get("/next", async (_req): Promise<string | null> => null);
  app.get("/counts", async (_req): Promise<Map<string, i64>> => new Map<string, i64>());
`));
  const names = `{"type":"array","items":{"type":"string"}}`;
  const pair = `{"type":"array","prefixItems":[{"type":"integer"},{"type":"string"}],"minItems":2,"items":false}`;
  const next = `{"anyOf":[{"type":"string"},{"type":"null"}]}`;
  const counts = `{"type":"object","additionalProperties":{"type":"integer"}}`;
  same(made.document, document(`"/names":{"get":{"responses":{${ok(names)}}}},"/pair":{"get":{"responses":{${ok(pair)}}}},"/next":{"get":{"responses":{${ok(next)}}}},"/counts":{"get":{"responses":{${ok(counts)}}}}`), "the document");
}, { timeout: 60_000 });

test("an openapi schema describes a data enum as the shapes its members are written in, and a handler giving nothing as 204", () => {
  const made = documented(program(`@derive(Json)
enum Cmd { Move(i64, i64), Say(string), Stop }
`, `  app.post("/run", async (_req, body: Cmd): Promise<void> => {
    console.log(JSON.stringify(body));
  });
`));
  const move = `{"type":"object","properties":{"Move":{"type":"array","prefixItems":[{"type":"integer"},{"type":"integer"}],"minItems":2,"items":false}},"required":["Move"]}`;
  const say = `{"type":"object","properties":{"Say":{"type":"string"}},"required":["Say"]}`;
  const cmd = `{"anyOf":[${move},${say},{"const":"Stop"}]}`;
  same(made.document, document(`"/run":{"post":{"requestBody":{"required":true,"content":{"application/json":{"schema":${cmd}}}},"responses":{"204":{"description":"No Content"},${REFUSED}}}}`), "the document");
}, { timeout: 60_000 });

test("an openapi document keeps a class and a type that holds itself under components, referred to where they are used", () => {
  const made = documented(program(`type Tree = { v: i64; kids: Tree[] };
@derive(Json)
class Tag {
  constructor(public name: string, public parent: Tag | null) {}
}
`, `  app.get("/tree", async (_req): Promise<Tree> => ({ v: 1, kids: [] }));
  app.get("/tags/:tag", async (req): Promise<Tag> => new Tag(req.param("tag"), null));
`));
  const tree = `{"type":"object","properties":{"kids":{"type":"array","items":{"$ref":"#/components/schemas/Tree"}},"v":{"type":"integer"}},"required":["kids","v"]}`;
  const tag = `{"type":"object","properties":{"name":{"type":"string"},"parent":{"anyOf":[{"$ref":"#/components/schemas/Tag"},{"type":"null"}]}},"required":["name","parent"]}`;
  const named = `"parameters":[{"name":"tag","in":"path","required":true,"schema":{"type":"string"}}]`;
  same(made.document, document(`"/tree":{"get":{"responses":{${ok(`{"$ref":"#/components/schemas/Tree"}`)}}}},"/tags/{tag}":{"get":{${named},"responses":{${ok(`{"$ref":"#/components/schemas/Tag"}`)}}}}`, `"Tag":${tag},"Tree":${tree}`), "the document");
}, { timeout: 60_000 });

test("an openapi document puts a mounted router's routes under its prefixes, a route for every method under each, and leaves out what it can't place", () => {
  const src = `async function main(): Promise<void> {
  let users = new Router();
  users.get("/", async (_req) => new Response("all"));
  users.get("/:id", async (_req): Promise<boolean> => true);
  let api = new Router();
  api.route("/users", users);
  let app = new Router();
  app.route("/api", api);
  app.all("/ping", async (_req) => new Response("pong"));
  app.get("/ping", async (_req): Promise<boolean> => true);
  app.route("PURGE", "/cache", async (_req) => new Response("gone"));
  const computed = "/computed";
  app.get(computed, async (_req) => new Response("x"));
  let other = new Router();
  other.get("/x", async (_req) => new Response("x"));
  app.route(computed, other);
  const res = await app.handle(new Request("http://h/ping"));
  console.log(res.status);
}
`;
  const made = documented(src);
  const id = `"parameters":[{"name":"id","in":"path","required":true,"schema":{"type":"string"}}]`;
  const every = ["get", "post", "put", "patch", "delete"].map((m) => `"${m}":{${UNTYPED}}`).join(",");
  same(made.document, document(`"/api/users":{"get":{${UNTYPED}}},"/api/users/{id}":{"get":{${id},"responses":{${ok(`{"type":"boolean"}`)}}}},"/ping":{${every}}`), "the document");
  same(made.left.join("\n"), `app.route("PURGE", "/cache", async (_req) => new Response("gone")): OpenAPI has no operation for the method 'PURGE'
app.get(computed, async (_req) => new Response("x")): its path isn't written as a string
other.get("/x", async (_req) => new Response("x")): its router is mounted under a prefix that isn't written as a string, or in a router that isn't held in a local variable`, "the routes left out");
}, { timeout: 60_000 });
