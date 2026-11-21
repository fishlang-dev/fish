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
    if (r.done) break;
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
    start: (c) => {
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
    pull: async (c) => {
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
async function main() {
  const stream = new ReadableStream<i64>({
    start: (c) => {
      c.enqueue(1);
      c.error(new Error("source failed"));
    },
  });
  let reader = stream.getReader();
  try {
    while (true) {
      const r = await reader.read();
      if (r.done) break;
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
    start: (c) => {
      c.enqueue(1);
      c.enqueue(2);
    },
    cancel: (reason) => console.log("cancelled", reason),
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
    write: async (chunk) => console.log("wrote", chunk),
    close: async () => console.log("closed"),
  });
  await ReadableStream.from(two()).pipeTo(dest);
}
// case: readable_stream_pipe_aborts_on_error
// expect: aborted broken
// expect: caught broken
async function main(): Promise<void> {
  const source = new ReadableStream<i64>({
    pull: async (c) => {
      c.enqueue(1);
      c.error(new Error("broken"));
    },
  });
  const dest = new WritableStream<i64>({
    write: async (chunk) => console.log("wrote", chunk),
    abort: (reason) => console.log("aborted", reason),
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
  const dest = new WritableStream<string>({ write: async (chunk) => console.log("got", chunk) });
  let writer = dest.getWriter();
  await writer.write("x");
  console.log(dest.locked);
  writer.releaseLock();
  console.log(dest.locked);
}
// case: readable_stream_pipe_through_pair
// expect: 1
// expect: 2
async function* two(): AsyncGenerator<i64> {
  yield 1;
  yield 2;
}

async function main() {
  // A pair whose writable side queues into its readable side, as a TransformStream would.
  const queue = new Channel<i64>(8);
  const into = queue.clone();
  const writable = new WritableStream<i64>({
    write: async (chunk) => {
      await into.send(chunk);
    },
    close: async () => into.close(),
  });
  const readable = ReadableStream.from(drained(queue));
  const out = ReadableStream.from(two()).pipeThrough({ writable, readable });
  for await (const x of out) console.log(x);
}

async function* drained(queue: Channel<i64>): AsyncGenerator<i64> {
  for await (const x of queue) yield x;
}
