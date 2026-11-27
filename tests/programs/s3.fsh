// std:s3: a Bun-style S3Client signing with SigV4, checked against AWS's published examples and a
// fake S3 server that recomputes each request's signature from what arrived.
// case: s3_sigv4_vectors
// expect: f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41
// expect: AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41
// expect: 98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd
// expect: fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543
// expect: 34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7
// expect: https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404
// The examples in AWS's S3 SigV4 documentation: GET Object with a Range, PUT Object, GET Bucket
// Lifecycle, GET Bucket (list) and a presigned GET, each with AWS's own example keys.
import { S3Client, signRequest } from "std:s3";
const EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
function main(): void throws TypeError {
  const date = new Date(1369353600000);
  const id = "AKIAIOSFODNN7EXAMPLE";
  const secret = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
  const host = "https://examplebucket.s3.amazonaws.com";
  const get = signRequest({ method: "GET", url: host + "/test.txt", headers: { range: "bytes=0-9", "x-amz-content-sha256": EMPTY, "x-amz-date": "20130524T000000Z" }, payloadHash: EMPTY, accessKeyId: id, secretAccessKey: secret, region: "us-east-1", date: date.clone() });
  console.log(get.signature);
  console.log(get.authorization);
  const body = "44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072";
  const put = signRequest({ method: "PUT", url: host + "/test%24file.text", headers: { date: "Fri, 24 May 2013 00:00:00 GMT", "x-amz-content-sha256": body, "x-amz-date": "20130524T000000Z", "x-amz-storage-class": "REDUCED_REDUNDANCY" }, payloadHash: body, accessKeyId: id, secretAccessKey: secret, region: "us-east-1", date: date.clone() });
  console.log(put.signature);
  const life = signRequest({ method: "GET", url: host + "/?lifecycle", headers: { "x-amz-content-sha256": EMPTY, "x-amz-date": "20130524T000000Z" }, payloadHash: EMPTY, accessKeyId: id, secretAccessKey: secret, region: "us-east-1", date: date.clone() });
  console.log(life.signature);
  const list = signRequest({ method: "GET", url: host + "/?max-keys=2&prefix=J", headers: { "x-amz-content-sha256": EMPTY, "x-amz-date": "20130524T000000Z" }, payloadHash: EMPTY, accessKeyId: id, secretAccessKey: secret, region: "us-east-1", date: date.clone() });
  console.log(list.signature);
  const s3 = new S3Client({ endpoint: "https://s3.amazonaws.com", bucket: "examplebucket", region: "us-east-1", accessKeyId: id, secretAccessKey: secret, virtualHostedStyle: true });
  console.log(s3.presign("test.txt", { expiresIn: 86400, date: date }));
}

// case: s3_fake_server
// expect: 5 3
// expect: hello [ 0, 255, 7 ]
// expect: true false
// expect: 1 true notes/a.txt 5 "e0"
// expect: 1 false notes/b.txt
// expect: 200 hello
// expect: 200 by url
// expect: false
// expect: S3Error NoSuchKey 404
// expect: SignatureDoesNotMatch 403 fake S3 refused it: SignatureDoesNotMatch
// Writes, reads, a key with a space, a plus and a non-ASCII letter, list pages, presigned GET and
// PUT URLs, a delete, a missing key and a wrong secret, against a server checking every signature.
import { S3Client, S3Error, signRequest } from "std:s3";
import { hash } from "crypto";

type Store = { objects: Lock<Map<string, u8[]>> };

const SECRET = "fake-secret";

// The time an x-amz-date names, in milliseconds since 1970.
function msOf(amz: string): i64 {
  let y = Number.parseInt(amz.slice(0, 4)) ?? 0;
  const m = Number.parseInt(amz.slice(4, 6)) ?? 0;
  const d = Number.parseInt(amz.slice(6, 8)) ?? 0;
  const hh = Number.parseInt(amz.slice(9, 11)) ?? 0;
  const mm = Number.parseInt(amz.slice(11, 13)) ?? 0;
  const ss = Number.parseInt(amz.slice(13, 15)) ?? 0;
  // Days from 1970 by Howard Hinnant's civil-from-days inverse; years here are after 1970.
  if (m <= 2) y -= 1;
  const era = y / 400;
  const yoe = y - era * 400;
  const doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  const doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  const days = era * 146097 + doe - 719468;
  return ((days * 24 + hh) * 60 + mm) * 60000 + ss * 1000;
}

// A path's %XX escapes as the UTF-8 bytes they stand for.
function percentDecoded(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let out: u8[] = [];
  let i: usize = 0;
  while (i < bytes.length) {
    if (bytes[i] === 37 && i + 2 < bytes.length) {
      out.push((Number.parseInt(text.slice((i + 1) as i64, (i + 3) as i64), 16) ?? 0) as u8);
      i += 3;
    } else {
      out.push(bytes[i]!);
      i += 1;
    }
  }
  return new TextDecoder().decode(out);
}

function fail(status: i64, code: string): Response {
  return new Response("<?xml version=\"1.0\"?><Error><Code>" + code + "</Code><Message>fake S3 refused it: " + code + "</Message></Error>", { status: status });
}

// The request's signature is recomputed from what arrived, as S3 does.
function signedOk(req: Ref<Request>, body: Ref<u8[]>): boolean throws TypeError {
  const url = new URL(req.url);
  const search = url.search;
  const at = search.indexOf("&X-Amz-Signature=");
  if (at >= 0) {
    const unsigned = req.url.slice(0, (req.url.length as i64) - (search.length as i64) + at);
    const given = search.slice(at + ("&X-Amz-Signature=".length as i64));
    const dateAt = search.indexOf("X-Amz-Date=") + ("X-Amz-Date=".length as i64);
    const s = signRequest({ method: req.method, url: unsigned, headers: {}, payloadHash: "UNSIGNED-PAYLOAD", accessKeyId: "fake-id", secretAccessKey: SECRET, region: "us-east-1", date: new Date(msOf(search.slice(dateAt, dateAt + 16))) });
    return s.signature === given;
  }
  const auth = req.headers.get("authorization") ?? "";
  const list = auth.indexOf("SignedHeaders=");
  if (list < 0) return false;
  const names = auth.slice(list + 14, auth.indexOf(",", list)).split(";");
  let headers: Record<string, string> = {};
  for (const n of names) if (n !== "host") headers[n] = req.headers.get(n) ?? "";
  const payload = req.headers.get("x-amz-content-sha256") ?? "";
  if (body.length > 0 && payload !== hash("sha256", body.clone(), "hex")) return false;
  const s = signRequest({ method: req.method, url: req.url, headers: headers, payloadHash: payload, accessKeyId: "fake-id", secretAccessKey: SECRET, region: "us-east-1", date: new Date(msOf(req.headers.get("x-amz-date") ?? "")) });
  return s.authorization === auth;
}

function listing(store: Ref<shared<Store>>, url: Ref<URL>): string {
  const q = url.searchParams.clone();
  const prefix = q.get("prefix") ?? "";
  const max = Number.parseInt(q.get("max-keys") ?? "1000") ?? 1000;
  const after = q.get("continuation-token") ?? "";
  let keys: string[] = [];
  let sizes = new Map<string, i64>();
  store.objects.update((m) => {
    for (const [k, v] of m) {
      keys.push(k);
      sizes.set(k, v.length as i64);
    }
  });
  keys.sort();
  let out = "";
  let n: i64 = 0;
  let next = "";
  for (const k of keys) {
    if (!k.startsWith(prefix) || k <= after) continue;
    if (n === max) {
      next = keys[(n - 1) as usize]!;
      break;
    }
    out += "<Contents><Key>" + k.replaceAll("&", "&amp;") + "</Key><LastModified>2026-11-27T00:00:00.000Z</LastModified><ETag>&quot;e" + String(n) + "&quot;</ETag><Size>" + String(sizes.get(k) ?? 0) + "</Size></Contents>";
    next = k;
    n++;
  }
  const truncated = n === max && keys.some((k) => k.startsWith(prefix) && k > next);
  return "<?xml version=\"1.0\"?><ListBucketResult><KeyCount>" + String(n) + "</KeyCount><IsTruncated>" + String(truncated) + "</IsTruncated>" + (truncated ? "<NextContinuationToken>" + next + "</NextContinuationToken>" : "") + out + "</ListBucketResult>";
}

async function handle(store: shared<Store>, req: Request): Promise<Response> throws TypeError {
  const body = await req.bytes();
  if (!signedOk(req, body)) return fail(403, "SignatureDoesNotMatch");
  const url = new URL(req.url);
  const path = percentDecoded(url.pathname);
  if (!path.startsWith("/media")) return fail(404, "NoSuchBucket");
  if (path === "/media" || path === "/media/") return new Response(listing(store, url));
  const key = path.slice(7);
  let found: u8[] | null = null;
  let had = false;
  store.objects.update((m) => {
    const v = m.get(key);
    had = v !== undefined;
    if (req.method === "PUT") m.set(key, body.clone());
    else if (req.method === "DELETE") m.delete(key);
    else if (v !== undefined) found = v.clone();
  });
  if (req.method === "PUT") return new Response("");
  if (req.method === "DELETE") return new Response(null, { status: 204 });
  if (found === null) return req.method === "HEAD" ? new Response(null, { status: 404 }) : fail(404, "NoSuchKey");
  return new Response(found);
}

async function main(): Promise<void> throws IoError | AbortError | TypeError {
  const port = shared({ n: new Atomic(0) });
  const seen = port.clone();
  const store = shared({ objects: new Lock(new Map<string, u8[]>()) });
  spawn(serve({ port: 0, hostname: "127.0.0.1", onListen: (info: ServeInfo) => { seen.n.store(info.port); } }, async (req: Request) => {
    try {
      return await handle(store.clone(), req);
    } catch (e) {
      return fail(400, "Bad");
    }
  }));
  while (port.n.load() === 0) await sleep(1);
  const endpoint = "http://127.0.0.1:" + String(port.n.load());
  const s3 = new S3Client({ endpoint: endpoint, region: "us-east-1", bucket: "media", accessKeyId: "fake-id", secretAccessKey: SECRET });
  try {
    const n1 = await s3.write("notes/a.txt", "hello");
    const raw: u8[] = [0, 255, 7];
    const n2 = await s3.write("photos/a b+é.bin", raw, { type: "application/octet-stream" });
    await s3.write("notes/b.txt", "second");
    console.log(n1, n2);
    const a = s3.file("notes/a.txt");
    const text = await a.text();
    const photo = s3.file("photos/a b+é.bin");
    const bin = await photo.bytes();
    console.log(text, bin);
    const there = await a.exists();
    const missing = await s3.exists("nope");
    console.log(there, missing);
    const page = await s3.list({ prefix: "notes/", maxKeys: 1 });
    console.log(page.keyCount, page.isTruncated, page.contents[0].key, page.contents[0].size, page.contents[0].eTag);
    const rest = await s3.list({ prefix: "notes/", continuationToken: page.nextContinuationToken ?? "" });
    console.log(rest.keyCount, rest.isTruncated, rest.contents[0].key);
    const url = s3.presign("notes/a.txt", { expiresIn: 60 });
    const got = await fetch(url);
    const gotText = await got.text();
    console.log(got.status, gotText);
    const put = s3.presign("notes/c.txt", { method: "PUT" });
    const sent = await fetch(put, { method: "PUT", body: "by url" });
    const cf = s3.file("notes/c.txt");
    const c = await cf.text();
    console.log(sent.status, c);
    await s3.delete("notes/a.txt");
    const gone = await a.exists();
    console.log(gone);
    await a.text();
  } catch (e) {
    if (e instanceof S3Error) console.log(e.name, e.code, e.status);
  }
  const wrong = new S3Client({ endpoint: endpoint, region: "us-east-1", bucket: "media", accessKeyId: "fake-id", secretAccessKey: "not it" });
  try {
    await wrong.write("x", "y");
  } catch (e) {
    if (e instanceof S3Error) console.log(e.code, e.status, e.message);
  }
}

// case: s3_settings
// expect: https://s3.eu-west-1.amazonaws.com/given/a.txt true
// expect: http://minio.test:9000/given/a.txt
// expect: https://given.r2.test/a%2Bb.txt
// expect: S3Client needs a bucket: pass { bucket } or set S3_BUCKET
// The endpoint follows the region when not given, a trailing slash is dropped, virtual-hosted
// style puts the bucket in the host, and a missing bucket is refused.
import { S3Client } from "std:s3";
function main(): void throws TypeError {
  const aws = new S3Client({ region: "eu-west-1", bucket: "given", accessKeyId: "id", secretAccessKey: "secret" }).presign("a.txt");
  console.log(aws.slice(0, aws.indexOf("?")), aws.includes("X-Amz-Credential=id%2F"));
  const minio = new S3Client({ endpoint: "http://minio.test:9000/", bucket: "given", accessKeyId: "id", secretAccessKey: "secret" }).presign("a.txt", { expiresIn: 10 });
  console.log(minio.slice(0, minio.indexOf("?")));
  const hosted = new S3Client({ endpoint: "https://r2.test", bucket: "given", accessKeyId: "id", secretAccessKey: "secret", virtualHostedStyle: true }).presign("a+b.txt");
  console.log(hosted.slice(0, hosted.indexOf("?")));
  try {
    new S3Client({ bucket: "", accessKeyId: "id", secretAccessKey: "secret" }).presign("a.txt");
  } catch (e) {
    console.log(e.message);
  }
}
