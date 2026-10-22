// error: which isn't the 'AbortError' that 'f' throws
function f<AbortError>(s: Ref<AbortSignal>, x: AbortError): i64 throws AbortError {
  s.throwIfAborted();
  return 1;
}
function main() {
  const c = new AbortController();
  c.abort();
  try {
    const v = f(c.signal, 5);
    console.log(v);
  } catch (e) {
    console.log("caught", e);
  }
}
