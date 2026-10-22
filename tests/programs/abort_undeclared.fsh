// error: 'step' must declare 'throws AbortError' after its return type since 'throwIfAborted' can throw 'AbortError'
function step(signal: Ref<AbortSignal>): i64 {
  signal.throwIfAborted();
  return 1;
}

function main() {
  const c = new AbortController();
  console.log(step(c.signal));
}
