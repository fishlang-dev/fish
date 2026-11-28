// `fishc client`: a TypeScript client of a program's typed routes, and `.d.ts` declarations of a
// file's exported types.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { clientOf, typesOf } from "../../src/client.fsh";
import { analyze } from "../../src/main.fsh";
import { cachedSession } from "../../src/mathlib.fsh";
import { parse } from "../../src/parser.fsh";
import { fishc, read, removed, same, scratch } from "./support.fsh";

const SHOP = `@derive(Json)
class Item {
  id: u32 = 0;
  name: string = "";
}
type NewItem = { name: string; price: f64; note?: string };
async function main(): Promise<void> {
  let app = new Router();
  app.get("/items/:id", async (_req): Promise<Item> => new Item());
  app.post("/items", async (_req, body: NewItem): Promise<boolean> => body.price > 0.0);
  app.delete("/items/:id", async (_req): Promise<void> => {});
  app.get("/health", async (_req) => new Response("ok"));
  const path = "/computed";
  app.get(path, async (_req) => new Response("x"));
  const res = await app.handle(new Request("http://h/"));
  console.log(res.status);
}
`;

function clientText(src: string): { code: string; left: string[] } {
  const dir = scratch("fish-client-");
  let out: { code: string; left: string[] } = { code: "", left: [] };
  try {
    const file = join(dir, "main.fsh");
    writeFileSync(file, src);
    const made = analyze(cachedSession(), src, file);
    const got = clientOf(made.checked.tables, "main.fsh");
    out.code = got.code;
    for (const l of got.left) out.left.push(l.why);
  } catch (e) {
    assert(false, `the check failed: ${e.message}`);
  }
  removed(dir);
  return out;
}

test(
  "a client has a typed method per route, the types its routes use declared by name",
  () => {
    const made = clientText(SHOP);
    assert(
      made.code.startsWith(
        "// Written by fishc client from main.fsh; change the Fish service and write it again.\n\nexport type Item = { id: number; name: string };\n\nexport class ClientError extends Error {",
      ),
      made.code,
    );
    for (const method of [
      '  async getItemsId(id: string): Promise<Item> {\n    const res = await this.send("GET", `/items/${encodeURIComponent(id)}`);\n    return (await res.json()) as Item;\n  }\n',
      '  async postItems(body: { name: string; note?: string; price: number }): Promise<boolean> {\n    const res = await this.send("POST", `/items`, body);\n    return (await res.json()) as boolean;\n  }\n',
      '  async deleteItemsId(id: string): Promise<void> {\n    await this.send("DELETE", `/items/${encodeURIComponent(id)}`);\n  }\n',
      '  async getHealth(): Promise<Response> {\n    return await this.send("GET", `/health`);\n  }\n}\n',
    ])
      assert(
        made.code.includes(method),
        `the method:\n${method}\nin:\n${made.code}`,
      );
    same(
      made.left.join("\n"),
      "its path isn't written as a string",
      "the route left out",
    );
  },
  { timeout: 60_000 },
);

test("a file's exported types become .d.ts declarations in TypeScript's terms for the JSON Fish writes", () => {
  const src = `export type Id = u64;
export type User = { id: Id; name: string; email: Option<string>; tags: string[]; scores: FixedArray<f64, 3> };
export interface Named { name: string; nick?: string }
export class Account {
  owner: string = "";
  #secret: i64 = 0;
  private hidden: i64 = 0;
  balance: f64 = 0.0;
}
export enum Color { Red, Green = 5, Blue }
export enum Shape { Dot, Circle(f64), Rect(f64, f64) }
type Hidden = i64;
`;
  let text = "";
  try {
    text = typesOf(src, parse(src, { last: 0 }), "types.fsh");
  } catch (e) {
    assert(false, e.message);
  }
  same(
    text,
    `// Written by fishc client --types from types.fsh; change the Fish types and write them again.

export type Id = number;
export type User = { id: Id; name: string; email: string | null; tags: string[]; scores: number[] };
export interface Named { name: string; nick?: string }
export interface Account { owner: string; balance: number }
export type Color = 0 | 5 | 6;
export type Shape = "Dot" | { Circle: number } | { Rect: [number, number] };
`,
    "the declarations",
  );
});

test(
  "fishc client prints or writes a client, and --types the declarations",
  () => {
    const dir = scratch("fish-client-");
    try {
      writeFileSync(join(dir, "main.fsh"), SHOP);
      writeFileSync(
        join(dir, "types.fsh"),
        "export type Point = { x: f64; y: f64 };\n",
      );
    } catch (e) {
      assert(false, e.message);
    }
    const printed = fishc(dir, ["client", "main.fsh"]);
    assert(
      printed.code === 0 &&
        printed.out.includes("async getItemsId(id: string): Promise<Item>"),
      `the client:\n${printed.out}\n${printed.err}`,
    );
    assert(
      printed.err.includes(
        "warning[W0003]: this route is left out of the client: its path isn't written as a string",
      ),
      printed.err,
    );
    const written = fishc(dir, ["client", "main.fsh", "-o", "client.ts"]);
    assert(written.code === 0 && written.out === "", written.err);
    same(read(join(dir, "client.ts")), printed.out, "the file -o wrote");
    const types = fishc(dir, ["client", "--types", "types.fsh"]);
    same(
      types.out,
      "// Written by fishc client --types from types.fsh; change the Fish types and write them again.\n\nexport type Point = { x: number; y: number };\n",
      "the declarations",
    );
    removed(dir);
  },
  { timeout: 120_000 },
);
