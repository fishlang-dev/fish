// expect: listening 108
// expect: no callback
// expect: none yet
// An optional callback field: a union of a stored callable and null, narrowed before calling.
type Info = { port: i64 };
type Options = { port: i64; onListen?: (info: Info) => void };
function start(options: Options) {
  const listen = options.onListen;
  if (listen !== null) listen({ port: options.port });
  else console.log("no callback");
}
function main() {
  const base = 100;
  start({ port: 8, onListen: (info: Info) => console.log("listening", info.port + base) });
  start({ port: 9 });
  let cb: ((n: i64) => i64) | null = null;
  if (cb === null) console.log("none yet");
}
