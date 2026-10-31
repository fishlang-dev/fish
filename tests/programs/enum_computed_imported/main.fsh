// expect: 2 3 30
import { Bits } from "./bits.fsh";

enum Other {
  X = Bits.Two + 1,
}

enum Here {
  Y = Other.X * 10,
}

function main() {
  console.log(Bits.Two, Other.X, Here.Y);
}
