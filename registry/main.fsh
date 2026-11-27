// The package registry's server: publishing with a token, search, package info, downloads with
// counts and yanking, and the index fishc reads, served over HTTP as `sparse+<url>/index`.
// Metadata is kept in SQLite; archives are files in a directory, or objects in an S3 bucket.
//
//   registry token <owner>   prints a new publish token for owner, kept only as its hash
//   registry                 serves on REGISTRY_HOST (127.0.0.1) and REGISTRY_PORT (8080)
//
// REGISTRY_DB names the SQLite file (registry.db) and REGISTRY_ARCHIVES the archive directory
// (archives). REGISTRY_S3_BUCKET, when set, keeps archives in that bucket instead, with the
// credentials std:s3 reads from the environment. REGISTRY_URL is the base clients reach the
// server at, for the index's download URLs; the request's own host when unset.
import { Database, RowError, SqliteError, type SqlValue } from "sqlite";
import { hash, randomUUID } from "crypto";
import { mkdirSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import { S3Client } from "std:s3";
import * as log from "std:log";

// What every handler is given: the database and where archives go.
type Registry = { db: Database; archives: string; bucket: string; base: string };

type PackageRow = { name: string; owner: string };
type VersionRow = { version: string; sha256: string; dependencies: string; unsafe: i64; yanked: i64; downloads: i64; published: string };
type Found = { name: string; downloads: i64; latest: string | null };

// The largest archive taken, as a build accepts.
const MAX_ARCHIVE: i64 = 64 * 1024 * 1024;

// A refusal a client caused, or a failure it is told of without its detail, as a JSON body.
class ApiError extends Error implements IntoResponse {
  status: i64;
  constructor(status: i64, message: string) {
    super(message);
    this.status = status;
  }
  intoResponse(): Response {
    return Response.json({ error: this.message }, { status: this.status });
  }
}

function env(name: string, fallback: string): string {
  const set = process.env[name];
  return set === null || set === "" ? fallback : set;
}

function validName(name: string): boolean {
  return /^[a-z][a-z0-9-]{0,63}$/.test(name);
}

// A semantic version written plainly, as the index keeps them.
function validVersion(version: string): boolean {
  return /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$/.test(version) && version.length <= 64;
}

// The database's failures are logged with what they said and reach the client as a bare 500.
async function rows<T>(db: Ref<Database>, sql: string, params: SqlValue[]): Promise<T[]> throws ApiError {
  try {
    return await db.query<T>(sql, params);
  } catch (e) {
    log.error("database query failed", { sql, message: e.message });
    throw new ApiError(500, "internal error");
  }
}

async function row<T>(db: Ref<Database>, sql: string, params: SqlValue[]): Promise<T | null> throws ApiError {
  try {
    return await db.queryOne<T>(sql, params);
  } catch (e) {
    log.error("database query failed", { sql, message: e.message });
    throw new ApiError(500, "internal error");
  }
}

async function exec(db: Ref<Database>, sql: string, params: SqlValue[]): Promise<i64> throws ApiError {
  try {
    const done = await db.run(sql, params);
    return done.changes;
  } catch (e) {
    log.error("database write failed", { sql, message: e.message });
    throw new ApiError(500, "internal error");
  }
}

async function schema(db: Ref<Database>): Promise<void> throws SqliteError {
  await db.run("create table if not exists tokens (hash text primary key, owner text not null)");
  await db.run("create table if not exists packages (name text primary key, owner text not null)");
  await db.run("create table if not exists versions (name text not null, version text not null, sha256 text not null, dependencies text not null, unsafe integer not null, yanked integer not null default 0, downloads integer not null default 0, published text not null, primary key (name, version))");
}

// The owner a request's bearer token belongs to.
async function owner(req: Ref<Request>, state: Ref<Registry>): Promise<string> throws ApiError {
  const given = req.headers.get("authorization") ?? "";
  if (!given.startsWith("Bearer ")) throw new ApiError(401, "send a token as 'authorization: Bearer <token>'");
  const found = await row<{ owner: string }>(state.db, "select owner from tokens where hash = ?", [hash("sha256", given.slice(7))]);
  if (found === null) throw new ApiError(401, "the token isn't one this registry gave");
  return found.owner;
}

// The owner may change a package's versions; anyone else is refused.
async function owned(req: Ref<Request>, state: Ref<Registry>, name: string): Promise<void> throws ApiError {
  const who = await owner(req, state);
  const pkg = await row<PackageRow>(state.db, "select name, owner from packages where name = ?", [name]);
  if (pkg === null) throw new ApiError(404, "no package '" + name + "'");
  if (pkg.owner !== who) throw new ApiError(403, "'" + name + "' belongs to another owner");
}

function key(name: string, version: string): string {
  return name + "@" + version + ".tar.gz";
}

async function store(state: Ref<Registry>, name: string, version: string, archive: u8[]): Promise<void> throws ApiError {
  try {
    if (state.bucket !== "") {
      const client = new S3Client({ bucket: state.bucket });
      await client.write(key(name, version), archive);
    } else await writeFile(state.archives + "/" + key(name, version), archive);
  } catch (e) {
    log.error("storing an archive failed", { name, version, message: e.message });
    throw new ApiError(500, "internal error");
  }
}

async function fetched(state: Ref<Registry>, name: string, version: string): Promise<u8[]> throws ApiError {
  try {
    if (state.bucket !== "") {
      const file = new S3Client({ bucket: state.bucket }).file(key(name, version));
      return await file.bytes();
    }
    return await readFile(state.archives + "/" + key(name, version));
  } catch (e) {
    log.error("reading an archive failed", { name, version, message: e.message });
    throw new ApiError(500, "internal error");
  }
}

function urlOf(req: Ref<Request>): URL throws ApiError {
  try {
    return new URL(req.url);
  } catch (_e) {
    throw new ApiError(400, "the request's URL doesn't parse");
  }
}

// The index's settings: where each version's archive is downloaded from.
async function config(req: Request, state: Registry): Promise<Response> throws ApiError {
  const base = state.base !== "" ? state.base : urlOf(req).origin;
  return Response.json({ dl: base + "/api/v1/packages/{name}/{version}/download" });
}

// A package's index file: one JSON line per version, oldest first, as fishc reads them.
async function indexFile(req: Request, state: Registry): Promise<Response> throws ApiError {
  const name = req.param("name");
  if (!validName(name) || req.param("prefix") !== name.slice(0, 2)) throw new ApiError(404, "no such index file");
  const versions = await rows<VersionRow>(state.db, "select * from versions where name = ? order by rowid", [name]);
  if (versions.length === 0) throw new ApiError(404, "no package '" + name + "'");
  let text = "";
  for (const v of versions) {
    text += "{\"name\":" + JSON.stringify(name) + ",\"version\":" + JSON.stringify(v.version) + ",\"dependencies\":" + v.dependencies + ",\"sha256\":\"" + v.sha256 + "\",\"yanked\":" + (v.yanked === 1 ? "true" : "false") + ",\"unsafe\":" + (v.unsafe === 1 ? "true" : "false") + "}\n";
  }
  return new Response(text);
}

// A release: the archive as the body, its dependencies and whether it uses unsafe as headers.
// The first to publish a name owns it.
async function publish(req: Request, state: Registry): Promise<Response> throws ApiError {
  const name = req.param("name");
  const version = req.param("version");
  if (!validName(name)) throw new ApiError(400, "'" + name + "' isn't a package name: lowercase letters, digits and '-', starting with a letter, at most 64 characters");
  if (!validVersion(version)) throw new ApiError(400, "'" + version + "' isn't a semantic version written plainly, as in 1.2.0");
  const who = await owner(req, state);
  let dependencies: { [name: string]: string } = {};
  try {
    dependencies = JSON.parse<{ [name: string]: string }>(req.headers.get("fish-dependencies") ?? "{}");
  } catch (_e) {
    throw new ApiError(400, "fish-dependencies isn't a JSON object of names and version ranges");
  }
  for (const [dep, range] of Object.entries(dependencies)) {
    if (!validName(dep) || range.length === 0 || range.length > 128 || /["\\\n\r]/.test(range)) throw new ApiError(400, "the dependency '" + dep + "' isn't a name with a version range");
  }
  const archive = await req.bytes();
  if (archive.length < 2 || archive[0] !== 31 || archive[1] !== 139) throw new ApiError(400, "the body isn't a gzipped archive");
  if ((archive.length as i64) > MAX_ARCHIVE) throw new ApiError(413, "the archive is larger than 64 MiB");
  const pkg = await row<PackageRow>(state.db, "select name, owner from packages where name = ?", [name]);
  if (pkg !== null && pkg.owner !== who) throw new ApiError(403, "'" + name + "' belongs to another owner");
  const had = await row<{ version: string }>(state.db, "select version from versions where name = ? and version = ?", [name, version]);
  if (had !== null) throw new ApiError(409, name + " " + version + " is already published; raise the version to publish again");
  const sum = hash("sha256", archive.clone());
  // The archive is stored first, so a version listed always has one.
  await store(state, name, version, archive);
  if (pkg === null) await exec(state.db, "insert or ignore into packages (name, owner) values (?, ?)", [name, who.clone()]);
  const unsafe = req.headers.get("fish-unsafe") === "true";
  await exec(state.db, "insert into versions (name, version, sha256, dependencies, unsafe, published) values (?, ?, ?, ?, ?, ?)", [name, version, sum.clone(), JSON.stringify(dependencies), unsafe, new Date().toISOString()]);
  log.info("published", { name, version, owner: who });
  return Response.json({ name, version, sha256: sum }, { status: 201 });
}

// A package's owner and versions, with their download counts.
async function info(req: Request, state: Registry): Promise<Response> throws ApiError {
  const name = req.param("name");
  const pkg = await row<PackageRow>(state.db, "select name, owner from packages where name = ?", [name]);
  if (pkg === null) throw new ApiError(404, "no package '" + name + "'");
  const versions = await rows<VersionRow>(state.db, "select * from versions where name = ? order by rowid", [name]);
  let downloads: i64 = 0;
  let listed: { version: string; yanked: boolean; downloads: i64; published: string }[] = [];
  for (const v of versions) {
    downloads += v.downloads;
    listed.push({ version: v.version, yanked: v.yanked === 1, downloads: v.downloads, published: v.published });
  }
  return Response.json({ name: pkg.name, owner: pkg.owner, downloads, versions: listed });
}

// Packages whose names hold q, most downloaded first, with their latest version not yanked.
async function search(req: Request, state: Registry): Promise<Response> throws ApiError {
  const params = urlOf(req).searchParams;
  const q = params.get("q") ?? "";
  const asked = parseInt(params.get("limit") ?? "20") ?? 20;
  const limit = asked < 1 ? 1 : asked > 100 ? 100 : asked;
  const found = await rows<Found>(state.db, "select name, sum(downloads) as downloads, (select v.version from versions v where v.name = versions.name and v.yanked = 0 order by v.rowid desc limit 1) as latest from versions where instr(name, ?) > 0 group by name order by downloads desc, name limit ?", [q, limit]);
  return Response.json({ packages: found });
}

// A version's archive, counted.
async function download(req: Request, state: Registry): Promise<Response> throws ApiError {
  const name = req.param("name");
  const version = req.param("version");
  const changed = await exec(state.db, "update versions set downloads = downloads + 1 where name = ? and version = ?", [name, version]);
  if (changed === 0) throw new ApiError(404, "no version " + version + " of '" + name + "'");
  const archive = await fetched(state, name, version);
  let headers = new Headers();
  headers.set("content-type", "application/gzip");
  return new Response(archive, { headers });
}

// Yanked versions stay downloadable for builds that locked them, and new resolutions pass them by.
async function marked(req: Request, state: Registry, yanked: boolean): Promise<Response> throws ApiError {
  const name = req.param("name");
  const version = req.param("version");
  await owned(req, state, name);
  const changed = await exec(state.db, "update versions set yanked = ? where name = ? and version = ?", [yanked, name, version]);
  if (changed === 0) throw new ApiError(404, "no version " + version + " of '" + name + "'");
  log.info(yanked ? "yanked" : "unyanked", { name, version });
  return Response.json({ name, version, yanked });
}

async function yank(req: Request, state: Registry): Promise<Response> throws ApiError {
  return await marked(req, state, true);
}

async function unyank(req: Request, state: Registry): Promise<Response> throws ApiError {
  return await marked(req, state, false);
}

async function main(): Promise<void> throws SqliteError | RowError | IoError {
  const db = await Database.open(env("REGISTRY_DB", "registry.db"));
  await schema(db);
  const args = process.argv.slice(2);
  if (args.length === 2 && args[0] === "token") {
    const token = "fsh_" + randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");
    await db.run("insert into tokens (hash, owner) values (?, ?)", [hash("sha256", token.clone()), args[1]]);
    console.log(token);
    return;
  }
  if (args.length > 0) {
    console.error("usage: registry [token <owner>]");
    process.exit(2);
  }
  const archives = env("REGISTRY_ARCHIVES", "archives");
  const bucket = env("REGISTRY_S3_BUCKET", "");
  if (bucket === "") mkdirSync(archives, { recursive: true });
  const state: Registry = { db, archives, bucket, base: env("REGISTRY_URL", "").replace(/\/+$/, "") };
  let app = new Router().state(state);
  app.get("/index/config.json", config);
  app.get("/index/:prefix/:name", indexFile);
  app.get("/api/v1/search", search);
  app.get("/api/v1/packages/:name", info);
  app.put("/api/v1/packages/:name/:version", publish);
  app.get("/api/v1/packages/:name/:version/download", download);
  app.post("/api/v1/packages/:name/:version/yank", yank);
  app.post("/api/v1/packages/:name/:version/unyank", unyank);
  const port = parseInt(env("REGISTRY_PORT", "8080")) ?? 8080;
  const hostname = env("REGISTRY_HOST", "127.0.0.1");
  await serve({ port, hostname, maxBodySize: MAX_ARCHIVE, onListen: (at) => { log.info("listening", { hostname: at.hostname, port: at.port }); } }, app.handler());
}
