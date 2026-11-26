// std:grpc: messages encoded as protobuf by @message, and services called over HTTP/2.
// case: grpc_messages
// expect: 089601120268692a01612a016231000000000000f83f380142040a02696e48feffffffffffffffff01500150ffffffffffffffffff015a020102
// expect: 150 hi [ 'a', 'b' ] 1.5 true in -2 [ 1, -1 ] [ 1, 2 ]
// expect: empty: 0
// expect: unknown fields skipped: 7
// expect: GrpcError 13 a protobuf varint runs past the message
// Fields numbered in declaration order, @field pinning one and those after counting on, each
// kind on the wire as protobuf puts it, and a decoder passing over fields it doesn't know.
import { message, field, GrpcError } from "std:grpc";

@message class Inner {
  label: string = "";
}

@message class Msg {
  id: i64 = 0;
  name: string = "";
  @field(5) tags: string[] = [];
  score: f64 = 0;
  ok: boolean = false;
  inner: Inner = new Inner();
  maybe: i32 | null = null;
  nums: i64[] = [];
  data: u8[] = [];
}

@message class Small {
  id: i64 = 0;
}

async function main(): Promise<void> throws GrpcError {
  let m = new Msg();
  m.id = 150;
  m.name = "hi";
  m.tags = ["a", "b"];
  m.score = 1.5;
  m.ok = true;
  m.inner.label = "in";
  m.maybe = -2;
  m.nums = [1, -1];
  m.data = [1, 2];
  const bytes = m.toBinary();
  console.log(bytes.toHex());
  const back = Msg.fromBinary(bytes.clone());
  console.log(back.id, back.name, back.tags, back.score, back.ok, back.inner.label, back.maybe, back.nums, back.data);
  console.log("empty:", new Msg().toBinary().length);
  // Msg's bytes read as Small: field 1 is id, and the rest are passed over.
  let seven = new Msg();
  seven.id = 7;
  seven.name = "x";
  console.log("unknown fields skipped:", Small.fromBinary(seven.toBinary()).id);
  try {
    Small.fromBinary([8, 128]);
  } catch (e) {
    console.log(e.name, e.code, e.message);
  }
}
// case: grpc_calls
// expect: unary: hello fish
// expect: stream: hi fish 0, hi fish 1
// expect: stream status: 5 no more
// expect: status: 3 a name is needed
// expect: unimplemented: 12 the server has no service other.Nope
// expect: still serving: hello again
// A Fish server and client over cleartext HTTP/2: a unary call, a server stream ending with a
// status, a call the handler fails, and one to a service the server doesn't have.
import { message, service, GrpcError, GrpcServer } from "std:grpc";

@message class HelloRequest {
  name: string = "";
}

@message class HelloReply {
  message: string = "";
}

@service("helloworld.Greeter")
interface Greeter {
  sayHello(req: HelloRequest): Promise<HelloReply | GrpcError>;
  lotsOfReplies(req: HelloRequest): AsyncGenerator<HelloReply | GrpcError>;
}

@service("other.Nope")
interface Nope {
  missing(req: HelloRequest): Promise<HelloReply>;
}

class MyGreeter {
  async sayHello(req: HelloRequest): Promise<HelloReply | GrpcError> {
    if (req.name.length === 0) return new GrpcError(3, "a name is needed");
    let r = new HelloReply();
    r.message = "hello " + req.name;
    return r;
  }

  async *lotsOfReplies(req: HelloRequest): AsyncGenerator<HelloReply | GrpcError> {
    for (let i = 0; i < 2; i++) {
      let r = new HelloReply();
      r.message = "hi " + req.name + " " + String(i);
      yield r;
    }
    yield new GrpcError(5, "no more");
  }
}

async function main(): Promise<void> throws GrpcError | IoError | AbortError {
  const server = new GrpcServer();
  server.add(greeterService(new MyGreeter()));
  const found = shared({ port: new Atomic(0) });
  const seen = found.clone();
  spawn(serve({ port: 0, hostname: "127.0.0.1", onListen: (info: ServeInfo) => { seen.port.store(info.port); } }, server.handler()));
  while (found.port.load() === 0) await sleep(1);
  const url = "http://127.0.0.1:" + String(found.port.load());
  const client = new GreeterClient(url);
  let req = new HelloRequest();
  req.name = "fish";
  const reply = await client.sayHello(req);
  console.log("unary:", reply.message);
  let got: string[] = [];
  try {
    for await (const r of client.lotsOfReplies(req)) got.push(r.message);
  } catch (e) {
    if (e instanceof GrpcError) {
      console.log("stream:", got.join(", "));
      console.log("stream status:", e.code, e.message);
    }
  }
  try {
    const empty = new HelloRequest();
    await client.sayHello(empty);
  } catch (e) {
    if (e instanceof GrpcError) console.log("status:", e.code, e.message);
  }
  try {
    const nope = new NopeClient(url);
    await nope.missing(req);
  } catch (e) {
    if (e instanceof GrpcError) console.log("unimplemented:", e.code, e.message);
  }
  req.name = "again";
  const again = await client.sayHello(req);
  console.log("still serving:", again.message);
}
// case: grpc_bad_field
// error: 'when' has a type protobuf can't carry
import { message } from "std:grpc";

@message class Event {
  when: Map<string, i64> = new Map();
}

function main() {}
