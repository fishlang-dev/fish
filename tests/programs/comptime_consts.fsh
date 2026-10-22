// expect: 4 hello world 1048576 16 mul 64 -1
// Top-level consts are computed while compiling and read from any function; comptime blocks
// check things while compiling.
type Op = { name: string; code: i64 };
function ops(): Op[] {
  let out: Op[] = [];
  const names = "add sub mul div".split(" ");
  for (let i = 0; i < names.length; i++) out.push({ name: names[i], code: (i + 1) as i64 * 16 });
  return out;
}
const OPS = ops();
const COUNT = OPS.length;
const GREETING = "hello " + "world";
const LIMIT: u32 = 1 << 20;
const SQUARES: i64[] = [1, 4, 9, 16];
comptime {
  if (COUNT !== 4) throw new IoError("expected four ops");
}
function code(name: string): i64 {
  for (const op of OPS) {
    if (op.name === name) return op.code;
  }
  return -1;
}
function main() {
  comptime {
    let total = 0;
    for (const s of SQUARES) total += s;
    if (total !== 30) throw new IoError("squares");
  }
  console.log(COUNT, GREETING, LIMIT, SQUARES[3], OPS[2].name, code("div"), code("nope"));
}
