import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newSession } from "../src/compilation.ts";
import { buildAsync } from "../src/main.ts";

// TLS between Fish and Bun, both ways, with the test-only certificates in tests/fixtures/tls.
// Each test builds its program with clang, which can be slow on a busy machine.
setDefaultTimeout(60_000);

const fixtures = join(import.meta.dir, "fixtures", "tls");
const tmp = mkdtempSync(join(tmpdir(), "fish-tls-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const session = newSession();

async function build(name: string, src: string): Promise<string> {
  const file = join(tmp, `${name}.fsh`);
  writeFileSync(file, src);
  const out = join(tmp, name);
  await buildAsync(session, file, out);
  return out;
}

// Fetches its first argument, trusting the PEM file its second names, or the system's
// certificates when it is empty.
const CLIENT = `import { readFileSync } from "node:fs";

async function main(): Promise<void> throws IoError {
  const url = process.argv[2];
  const ca = process.argv[3] === "" ? "" : readFileSync(process.argv[3], "utf8");
  try {
    const res = await fetch(url, { tls: { ca: ca } });
    const text = await res.text();
    console.log(res.status, text);
  } catch (e) {
    if (e instanceof IoError) console.log(e.code, e.message);
    else console.log("aborted");
  }
}
`;

async function run(binary: string, args: string[]): Promise<string> {
  const proc = Bun.spawn([binary, ...args], { env: { ...process.env, FISH_LEAKS: "1" }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  expect(stderr).toBe("");
  expect(await proc.exited).toBe(0);
  return stdout;
}

test("a Fish client fetches from Bun's HTTPS server, and refuses it untrusted", async () => {
  const client = await build("client", CLIENT);
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    tls: { cert: Bun.file(join(fixtures, "server.pem")), key: Bun.file(join(fixtures, "server-key.pem")) },
    fetch: (req) => new Response(`bun ${new URL(req.url).pathname}`),
  });
  try {
    expect(await run(client, [`https://localhost:${server.port}/x`, join(fixtures, "ca.pem")])).toBe("200 bun /x\n");
    expect(await run(client, [`https://localhost:${server.port}/x`, ""])).toBe("UNABLE_TO_GET_ISSUER_CERT_LOCALLY certificate verify failed: unable to get local issuer certificate\n");
  } finally {
    server.stop(true);
  }
});

test("Bun's fetch reaches a Fish HTTPS server", async () => {
  const src = `import { readFileSync } from "node:fs";

async function main(): Promise<void> throws IoError {
  const dir = process.argv[2];
  const keys = { cert: readFileSync(dir + "/server.pem", "utf8"), key: readFileSync(dir + "/server-key.pem", "utf8") };
  await serve({ port: parseInt(process.argv[3]) ?? 0, hostname: "127.0.0.1", tls: keys }, async (req: Request) => {
    return new Response("fish " + req.url);
  });
}
`;
  const binary = await build("server", src);
  // A port free a moment ago, since the server's stdout is buffered until it exits.
  const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const port = probe.port;
  probe.stop(true);
  const proc = Bun.spawn([binary, fixtures, String(port)], { stdout: "pipe", stderr: "pipe" });
  try {
    const ca = readFileSync(join(fixtures, "ca.pem"), "utf8");
    let res: Response | undefined;
    for (let tries = 0; !res && tries < 100; tries++) {
      res = await fetch(`https://localhost:${port}/y`, { tls: { ca } }).catch(() => Bun.sleep(50).then(() => undefined));
    }
    if (!res) throw new Error("the Fish server never answered");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(`fish https://localhost:${port}/y`);
  } finally {
    proc.kill();
    await proc.exited;
  }
});
