// error: 'aborted' is read-only: the runtime keeps it
function main() {
  let c = new AbortController();
  let s = c.signal;
  s.aborted = true;
}
