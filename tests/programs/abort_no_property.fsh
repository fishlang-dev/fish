// error: property 'reason' does not exist on type 'AbortSignal'
function main() {
  const c = new AbortController();
  const r = c.signal.reason;
}
