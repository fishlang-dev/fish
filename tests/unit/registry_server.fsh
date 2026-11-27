// The registry server in registry/, built with the native fishc and driven from one shell: a token,
// publishing, the index fishc reads, search, info, downloads with counts, yanking, and `fishc add`
// resolving through `--registry`. Each step prints one line the test compares.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fishc, fishcPath, freePort, removed, root, same, scratch, text } from "./support.fsh";

const SCRIPT = String.raw`set -u
reg="$1"; port="$2"; fishc="$3"
export REGISTRY_DB="$PWD/registry.db" REGISTRY_ARCHIVES="$PWD/archives" REGISTRY_PORT="$port" FISH_CACHE_DIR="$PWD/cache"
token=$("$reg" token ann)
other=$("$reg" token bob)
"$reg" 2>server.log & pid=$!
trap 'kill $pid 2>/dev/null' EXIT
base="http://127.0.0.1:$port"
for i in $(seq 100); do curl -s -o /dev/null "$base/index/config.json" && break; sleep 0.1; done
printf 'greet archive' | gzip -n > greet.tar.gz
put() { curl -s -o /dev/null -w "%{http_code}\n" -X PUT -H "authorization: Bearer $1" -H 'fish-dependencies: {}' -H 'fish-unsafe: false' --data-binary @greet.tar.gz "$base/api/v1/packages/greet/$2"; }
echo "publish $(put "$token" 1.0.0)"
echo "again $(put "$token" 1.0.0)"
echo "other owner $(put "$other" 1.1.0)"
echo "no token $(curl -s -o /dev/null -w '%{http_code}' -X PUT --data-binary @greet.tar.gz "$base/api/v1/packages/greet/1.2.0")"
echo "second $(put "$token" 1.1.0)"
echo "config $(curl -s "$base/index/config.json")"
curl -s "$base/index/gr/greet" | sed 's/"sha256":"[0-9a-f]*"/"sha256":"-"/'
echo "download $(curl -s "$base/api/v1/packages/greet/1.0.0/download" | gunzip)"
echo "yank $(curl -s -o /dev/null -w '%{http_code}' -X POST -H "authorization: Bearer $token" "$base/api/v1/packages/greet/1.1.0/yank")"
echo "info $(curl -s "$base/api/v1/packages/greet" | sed 's/"published":"[^"]*"/"published":"-"/g')"
echo "search $(curl -s "$base/api/v1/search?q=ree")"
echo "missing $(curl -s -w ' %{http_code}' "$base/api/v1/packages/nothing")"
"$fishc" new app >/dev/null && cd app && "$fishc" add greet --registry "sparse+$base/index" >/dev/null && grep greet fish.toml
`;

test("the registry server publishes, serves the index fishc reads, counts downloads and yanks", () => {
  const dir = scratch("fish-registry-server-");
  const server = join(dir, "registry");
  const made = fishc(root(), ["build", "registry/main.fsh", "-o", server]);
  same(made.err, "", "building the registry");
  const port = freePort();
  const run = spawnSync("sh", ["-c", SCRIPT, "sh", server, String(port), fishcPath()], { cwd: dir });
  same(text(run.stdout), [
    "publish 201",
    "again 409",
    "other owner 403",
    "no token 401",
    "second 201",
    `config {"dl":"http://127.0.0.1:${port}/api/v1/packages/{name}/{version}/download"}`,
    `{"name":"greet","version":"1.0.0","dependencies":{},"sha256":"-","yanked":false,"unsafe":false}`,
    `{"name":"greet","version":"1.1.0","dependencies":{},"sha256":"-","yanked":false,"unsafe":false}`,
    "download greet archive",
    "yank 200",
    `info {"downloads":1,"name":"greet","owner":"ann","versions":[{"downloads":1,"published":"-","version":"1.0.0","yanked":false},{"downloads":0,"published":"-","version":"1.1.0","yanked":true}]}`,
    `search {"packages":[{"downloads":1,"latest":"1.0.0","name":"greet"}]}`,
    `missing {"error":"no package 'nothing'"} 404`,
    `greet = { version = "^1.0.0" }`,
    "",
  ].join("\n"), "the session");
  removed(dir);
}, { timeout: 600_000 });
