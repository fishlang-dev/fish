// expect: false
// expect: stopped This operation was aborted
// expect: true
// expect: wrapped This operation was aborted
async function work(signal: AbortSignal): Promise<i64> throws AbortError {
  let n = 0;
  while (true) {
    signal.throwIfAborted();
    n++;
    await yieldNow();
  }
  return n;
}

class ApiError implements From<AbortError> {
  why: string;
  constructor(why: string) {
    this.why = why;
  }
  static from(e: AbortError): ApiError {
    return new ApiError("wrapped " + e.message);
  }
}

function check(signal: Ref<AbortSignal>): i64 throws ApiError {
  signal.throwIfAborted();
  return 1;
}

async function main() {
  const c = new AbortController();
  console.log(c.signal.aborted);
  const h = spawn(work(c.signal));
  await sleep(10);
  c.abort();
  try {
    const n = await h;
    console.log("finished", n);
  } catch (e) {
    console.log("stopped", e.message);
  }
  const signal = c.signal;
  console.log(signal.aborted);
  try {
    const one = check(signal);
  } catch (e) {
    console.log(e.why);
  }
}
