// case: readable_stream_from_reader
// expect: false
// expect: true
// expect: 1
// expect: 2
// expect: done
async function* counted(): AsyncGenerator<i64> {
  yield 1;
  yield 2;
}

async function main(): Promise<void> throws Error | TypeError {
  const stream = ReadableStream.from(counted());
  console.log(stream.locked);
  let reader = stream.getReader();
  console.log(stream.locked);
  while (true) {
    const r = await reader.read();
    if (r.done === true) break;
    console.log(r.value);
  }
  console.log("done");
}
// case: readable_stream_for_await
// expect: a
// expect: b
async function* letters(): AsyncGenerator<string> {
  yield "a";
  yield "b";
}

async function main() {
  const stream = ReadableStream.from(letters());
  for await (const x of stream) console.log(x);
}
// case: readable_stream_locked_refuses_second_reader
// expect: this ReadableStream is locked to a reader; release it with 'reader.releaseLock()' first
// expect: 1
async function* one(): AsyncGenerator<i64> {
  yield 1;
}

async function main(): Promise<void> throws Error | TypeError {
  const stream = ReadableStream.from(one());
  let first = stream.getReader();
  try {
    const _second = stream.getReader();
  } catch (e) {
    console.log(e.message);
  }
  first.releaseLock();
  let again = stream.getReader();
  const r = await again.read();
  if (r.done === false) console.log(r.value);
}
// case: readable_stream_start_enqueues
// expect: 10
// expect: 20
// expect: closed
async function main() {
  const stream = new ReadableStream<i64>({
    start: (c: ReadableStreamDefaultController<i64>) => {
      c.enqueue(10);
      c.enqueue(20);
      c.close();
    },
  });
  for await (const x of stream) console.log(x);
  console.log("closed");
}
// case: readable_stream_pull_on_demand
// expect: pull 0
// expect: 0
// expect: pull 1
// expect: 1
// expect: pull 2
async function main(): Promise<void> throws Error | TypeError {
  const made = new Atomic(0);
  const stream = new ReadableStream<i64>({
    pull: (c: ReadableStreamDefaultController<i64>) => {
      const n = made.add(1);
      console.log("pull", n);
      if (n < 2) c.enqueue(n);
      else c.close();
    },
  });
  for await (const x of stream) console.log(x);
}
// case: readable_stream_error_reaches_reader
// expect: caught source failed
// An error drops what was queued, as the web streams spec has it, so the 1 is never read.
async function main(): Promise<void> throws TypeError {
  const stream = new ReadableStream<i64>({
    start: (c: ReadableStreamDefaultController<i64>) => {
      c.enqueue(1);
      c.error(new Error("source failed"));
    },
  });
  let reader = stream.getReader();
  try {
    while (true) {
      const r = await reader.read();
      if (r.done === true) break;
      console.log(r.value);
    }
  } catch (e) {
    console.log("caught", e.message);
  }
}
// case: readable_stream_cancel_runs_source_cancel
// expect: 1
// expect: cancelled enough
async function main(): Promise<void> throws Error | TypeError {
  const stream = new ReadableStream<i64>({
    start: (c: ReadableStreamDefaultController<i64>) => {
      c.enqueue(1);
      c.enqueue(2);
    },
    cancel: (reason: string) => console.log("cancelled", reason),
  });
  let reader = stream.getReader();
  const r = await reader.read();
  if (r.done === false) console.log(r.value);
  await reader.cancel("enough");
}
// case: readable_stream_pipe_to_writer
// expect: wrote 1
// expect: wrote 2
// expect: closed
async function* two(): AsyncGenerator<i64> {
  yield 1;
  yield 2;
}

async function main(): Promise<void> throws Error | TypeError {
  const dest = new WritableStream<i64>({
    write: (chunk: i64) => console.log("wrote", chunk),
    close: () => console.log("closed"),
  });
  const source = ReadableStream.from(two());
  await source.pipeTo(dest);
}
// case: readable_stream_pipe_aborts_on_error
// expect: aborted broken
// expect: caught broken
async function main(): Promise<void> {
  const source = new ReadableStream<i64>({
    pull: (c: ReadableStreamDefaultController<i64>) => {
      c.enqueue(1);
      c.error(new Error("broken"));
    },
  });
  const dest = new WritableStream<i64>({
    write: (chunk: i64) => console.log("wrote", chunk),
    abort: (reason: string) => console.log("aborted", reason),
  });
  try {
    await source.pipeTo(dest);
  } catch (e) {
    console.log("caught", e.message);
  }
}
// case: readable_stream_writer_direct
// expect: got x
// expect: true
// expect: false
async function main(): Promise<void> throws TypeError {
  const dest = new WritableStream<string>({ write: (chunk: string) => console.log("got", chunk) });
  let writer = dest.getWriter();
  await writer.write("x");
  console.log(dest.locked);
  writer.releaseLock();
  console.log(dest.locked);
}
// case: readable_stream_pipe_through_pair
// expect: 7
// expect: 8
// expect: piped 3
// pipeThrough pipes into the pair's writable side in the background and gives its readable
// side, which is read here; the writable side counts what reached it.
async function* two(): AsyncGenerator<i64> {
  yield 1;
  yield 2;
}

async function* out(): AsyncGenerator<i64> {
  yield 7;
  yield 8;
}

async function main() {
  const seen = shared({ total: new Atomic(0) });
  const counted = seen.clone();
  const writable = new WritableStream<i64>({ write: (chunk: i64) => { counted.total.add(chunk); } });
  const readable = ReadableStream.from(out());
  const through = ReadableStream.from(two()).pipeThrough({ writable, readable });
  for await (const x of through) console.log(x);
  while (seen.total.load() < 3) await sleep(1);
  console.log("piped", seen.total.load());
}
// case: readable_stream_response_body
// expect: true
// expect: 2 chunks, 5 bytes
// expect: {"n":4} 4
// A response's body as a stream: none for an empty one, the stream it was given, and a
// streamed body read whole by text() and json().
async function* chunks(): AsyncGenerator<u8[]> {
  yield [104, 101];
  yield [108, 108, 111];
}

async function* json(): AsyncGenerator<u8[]> {
  yield new TextEncoder().encode("{\"n\":");
  yield new TextEncoder().encode("4}");
}

async function main(): Promise<void> throws Error | TypeError | JsonError {
  console.log(new Response(null).body === null);
  const res = new Response(ReadableStream.from(chunks()));
  const body = res.body!;
  let reader = body.getReader();
  let count = 0;
  let size = 0;
  while (true) {
    const r = await reader.read();
    if (r.done === true) break;
    count++;
    size += r.value.length as i64;
  }
  console.log(count, "chunks,", size, "bytes");
  const first = new Response(ReadableStream.from(json()));
  const text = await first.text();
  const second = new Response(ReadableStream.from(json()));
  const data = await second.json<{ n: i64 }>();
  console.log(text, data.n);
}
// case: readable_stream_served_and_fetched
// expect: 200 chunked hello world
// A handler's response made from a byte stream goes out chunk by chunk, and fetch reads it back.
async function* greeting(): AsyncGenerator<u8[]> {
  yield new TextEncoder().encode("hello ");
  await sleep(5);
  yield new TextEncoder().encode("world");
}

async function main(): Promise<void> throws IoError | AbortError {
  const found = shared({ port: new Atomic(0) });
  const seen = found.clone();
  spawn(serve({ port: 0, hostname: "127.0.0.1", onListen: (info: ServeInfo) => { seen.port.store(info.port); } }, async (req: Request) => {
    return new Response(ReadableStream.from(greeting()));
  }));
  while (found.port.load() === 0) await sleep(1);
  const res = await fetch("http://127.0.0.1:" + String(found.port.load()) + "/");
  const text = await res.text();
  console.log(res.status, res.headers.get("transfer-encoding"), text);
}
// case: readable_stream_request_body
// expect: handler stream: 9 bytes
// expect: POST got 9 bytes: streamed!
// A request body given as a stream is read whole and sent with a length, and a handler reads
// the request's body through req.body.
async function* parts(): AsyncGenerator<u8[]> {
  yield new TextEncoder().encode("stream");
  yield new TextEncoder().encode("ed!");
}

async function main(): Promise<void> throws IoError | AbortError {
  const found = shared({ port: new Atomic(0) });
  const seen = found.clone();
  spawn(serve({ port: 0, hostname: "127.0.0.1", onListen: (info: ServeInfo) => { seen.port.store(info.port); } }, async (req: Request) => {
    const body = req.body;
    let size = 0;
    if (body !== null) for await (const chunk of body) size += chunk.length as i64;
    console.log("handler stream:", size, "bytes");
    return new Response(req.method + " got " + (req.headers.get("content-length") ?? "") + " bytes: ");
  }));
  while (found.port.load() === 0) await sleep(1);
  const res = await fetch("http://127.0.0.1:" + String(found.port.load()) + "/", { method: "POST", body: ReadableStream.from(parts()) });
  const text = await res.text();
  console.log(text + "streamed!");
}
