type R = { ok: true; v: i64 } | { ok: false; e: i64 }

function main() {
  const r: R = { ok: true }
}
// error: type '{ ok: boolean }' is not assignable to type '{ e: i64; ok: false } | { ok: true; v: i64 }'
