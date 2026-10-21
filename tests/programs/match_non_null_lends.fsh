type Box = { s: string };
type W = { b: Box };
function main() {
  let x: W | null = { b: { s: "hello" + "1" } };
  match (x!) {
    case { b } => {
      x = null;
      console.log(b.s);
    },
  };
}
// error: cannot change 'x' while 'b' borrows 'x'
