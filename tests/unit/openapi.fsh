// Typed routes: the route table a check fills in.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyze } from "../../src/main.fsh";
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
