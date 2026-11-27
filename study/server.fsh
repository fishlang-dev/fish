// The paper-test study: TypeScript developers fix hand-translated Rust programs in Fish, in the
// browser, compiled by the playground's compiler. After a participant consents, the page records
// what happens in each task, anonymously, in SQLite: no name, address or browser detail, only a
// random session id. `/export.json` gives every event and `/summary` what they add up to.
// PORT (default 8090), HOST (default 127.0.0.1) and STUDY_DB (default `study.db`) set where it
// listens and what it writes.
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { Database, RowError, SqliteError } from "sqlite";
import { KINDS, summarize, type EventRow, type TaskSummary } from "./summary.fsh";
import { TASKS } from "./tasks.fsh";

type Consent = { consent: boolean };
type EventIn = { session: string; task: string; kind: string; codes: string[]; ms: i64 };
type Made = { id: string };
type Seen = { id: string };

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, started INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, session TEXT NOT NULL REFERENCES sessions(id), task TEXT NOT NULL, kind TEXT NOT NULL, codes TEXT NOT NULL, ms INTEGER NOT NULL, at INTEGER NOT NULL)",
];
// A day: a task left open longer than this isn't timing anything.
const MAX_MS: i64 = 24 * 60 * 60 * 1000;

function plain(body: string, status: i64): Response {
  let headers = new Headers();
  headers.set("content-type", "text/plain; charset=utf-8");
  return new Response(body, { status, headers });
}

// Why an event can't be recorded, or "" when it can.
export function invalid(e: Ref<EventIn>): string {
  if (!/^[0-9a-f]{32}$/.test(e.session)) return "the session id is 32 hex digits";
  if (!TASKS.some((t) => t.id === e.task)) return `there is no task '${e.task}'`;
  if (!KINDS.includes(e.kind)) return `an event is one of ${KINDS.join(", ")}`;
  if (e.codes.length > 20 || e.codes.some((c) => !/^[EW]\d{4}$/.test(c))) return "codes are at most 20 diagnostic codes, as E0201";
  if (e.ms < 0 || e.ms > MAX_MS) return "ms is the time since the task started, at most a day";
  return "";
}

function escaped(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// The summary as a page of its own.
export function summaryPage(rows: Ref<TaskSummary[]>): string {
  let body = "";
  for (const r of rows) {
    const time = r.medianMs === null ? "-" : `${Math.round((r.medianMs as f64) / 1000.0)} s`;
    const errors = r.errors.map(([c, n]) => `${escaped(c)} &times; ${n}`).join(", ");
    body += `<tr><td>${escaped(r.title)}</td><td>${r.started}</td><td>${r.compiles}</td><td>${r.solved}</td><td>${r.gaveUp}</td><td>${time}</td><td>${errors}</td></tr>\n`;
  }
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Study Summary</title>
<style>body{font:15px/1.45 system-ui,sans-serif;margin:24px;background:#fbfbf9;color:#1d1f21}table{border-collapse:collapse}td,th{border-bottom:1px solid #dcdcd6;padding:6px 10px;text-align:left}@media (prefers-color-scheme: dark){body{background:#15171a;color:#e6e6e3}td,th{border-color:#2c3036}}</style></head>
<body><h1>Study summary</h1><p><a href="/export.json">Every event as JSON</a></p>
<table><tr><th>Task</th><th>Started</th><th>Compiles</th><th>Solved</th><th>Gave up</th><th>Median time to solve</th><th>Errors met most</th></tr>
${body}</table></body></html>
`;
}

/** @throws {SqliteError} */
export async function opened(path: string): Promise<Database> {
  const db = await Database.open(path);
  for (const s of SCHEMA) await db.run(s);
  return db;
}

// What a body that isn't the JSON a route takes answers.
function unreadable(): Response {
  return plain("the body isn't the JSON this takes\n", 400);
}

/** @throws {SqliteError} */
async function newSession(db: Ref<Database>, req: Request): Promise<Response> {
  let body: Consent = { consent: false };
  try {
    const written = await req.text();
    body = JSON.parse<Consent>(written);
  } catch (_e) {
    return unreadable();
  }
  if (body.consent !== true) return plain("a session is recorded only with consent\n", 400);
  const id = randomBytes(16).toString("hex");
  await db.run("INSERT INTO sessions (id, started) VALUES (?, ?)", [id, Date.now()]);
  const made: Made = { id };
  return Response.json(made);
}

/** @throws {SqliteError | RowError} */
async function newEvent(db: Ref<Database>, req: Request): Promise<Response> {
  let body: EventIn = { session: "", task: "", kind: "", codes: [], ms: 0 };
  try {
    const written = await req.text();
    body = JSON.parse<EventIn>(written);
  } catch (_e) {
    return unreadable();
  }
  const why = invalid(body);
  if (why !== "") return plain(`${why}\n`, 400);
  const known = await db.queryOne<Seen>("SELECT id FROM sessions WHERE id = ?", [body.session]);
  if (known === null) return plain("no such session\n", 404);
  await db.run("INSERT INTO events (session, task, kind, codes, ms, at) VALUES (?, ?, ?, ?, ?, ?)", [body.session, body.task, body.kind, body.codes.join(","), body.ms, Date.now()]);
  return new Response(null, { status: 204 });
}

/** @throws {SqliteError | RowError} */
async function events(db: Ref<Database>): Promise<EventRow[]> {
  return await db.query<EventRow>("SELECT session, task, kind, codes, ms, at FROM events ORDER BY id");
}

function failed(message: string): Response {
  return plain(`the database failed: ${message}\n`, 500);
}

// The study's routes, each handed the one database as the router's state.
export function study(db: Database, publicDir: string, compilerDir: string): StateRouter<Database> {
  let app = new Router().state(db);
  app.get("/api/tasks", async (_req, _db) => Response.json(TASKS));
  app.post("/api/sessions", async (req, db) => {
    try {
      return await newSession(db, req);
    } catch (e) {
      return failed(e.message);
    }
  });
  app.post("/api/events", async (req, db) => {
    try {
      return await newEvent(db, req);
    } catch (e) {
      return failed(e.message);
    }
  });
  app.get("/export.json", async (_req, db) => {
    try {
      const rows = await events(db);
      return Response.json(rows);
    } catch (e) {
      return failed(e.message);
    }
  });
  app.get("/summary", async (_req, db) => {
    try {
      const rows = await events(db);
      let headers = new Headers();
      headers.set("content-type", "text/html; charset=utf-8");
      return new Response(summaryPage(summarize(rows)), { headers });
    } catch (e) {
      return failed(e.message);
    }
  });
  app.static("/compiler", compilerDir);
  app.static("/", publicDir);
  return app;
}

async function main(): Promise<void> throws IoError | SqliteError {
  const port = parseInt(process.env["PORT"] ?? "8090") ?? 8090;
  const hostname = process.env["HOST"] ?? "127.0.0.1";
  const db = await opened(process.env["STUDY_DB"] ?? "study.db");
  console.log(`study on http://${hostname}:${port}/`);
  await serve({ port, hostname }, study(db, join(import.meta.dir, "public"), join(import.meta.dir, "..", "playground", "public")).handler());
}
