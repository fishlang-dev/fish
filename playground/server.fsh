// The playground's server: the page and its compiler from `public/`, and share links, each a
// program's source kept on disk under the first 12 hex digits of its SHA-256. It stores nothing
// else. PORT (default 8080), HOST (default 127.0.0.1) and PLAYGROUND_DATA (default `shares`)
// set where it listens and keeps them.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The largest program a link keeps, in bytes.
export const LIMIT: usize = 64 * 1024;
const ID = /^[0-9a-f]{12}$/;

export function shareId(source: string): string {
  return createHash("sha256").update(source).digest("hex").slice(0, 12);
}

function text(body: string, status: i64): Response {
  let headers = new Headers();
  headers.set("content-type", "text/plain; charset=utf-8");
  // A shared program is shown as text, never run as the page's script.
  headers.set("x-content-type-options", "nosniff");
  return new Response(body, { status, headers });
}

// Keeps `source` under its id, once however often it is shared.
/** @throws {IoError} */
function kept(data: string, source: string): string {
  const id = shareId(source);
  const file = join(data, `${id}.fsh`);
  if (!existsSync(file)) writeFileSync(file, source);
  return id;
}

export function playground(root: string, data: string): Router {
  let app = new Router();
  app.post("/api/share", async (req) => {
    const body = await req.bytes();
    if (body.length === 0) return text("nothing to share\n", 400);
    if (body.length > LIMIT) return text(`a shared program is at most ${LIMIT} bytes\n`, 413);
    try {
      return Response.json({ id: kept(data, new TextDecoder().decode(body)) });
    } catch (e) {
      return text(`can't keep it: ${e.message}\n`, 500);
    }
  });
  app.get("/api/share/:id", async (req) => {
    const id = req.param("id");
    const file = join(data, `${id}.fsh`);
    if (!ID.test(id) || !existsSync(file)) return text("no program is shared under that link\n", 404);
    try {
      return text(readFileSync(file, "utf8"), 200);
    } catch (e) {
      return text(`can't read it: ${e.message}\n`, 500);
    }
  });
  app.static("/", root);
  return app;
}

async function main(): Promise<void> throws IoError {
  const port = parseInt(process.env["PORT"] ?? "8080") ?? 8080;
  const hostname = process.env["HOST"] ?? "127.0.0.1";
  const data = process.env["PLAYGROUND_DATA"] ?? "shares";
  mkdirSync(data, { recursive: true });
  const root = join(import.meta.dir, "public");
  console.log(`playground on http://${hostname}:${port}/`);
  await serve({ port, hostname }, playground(root, data).handler());
}
