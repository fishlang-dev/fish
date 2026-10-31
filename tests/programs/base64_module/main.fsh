// expect: aGk= 6869
// expect: [ 104, 105 ]
import { encode, decode } from "./codec.fsh";

function main(): void throws TypeError {
  console.log(encode("hi"));
  console.log(decode("6869"));
}
