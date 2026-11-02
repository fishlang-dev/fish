// Each file sees its own import.meta, and only the entry file is main.
// expect: main.fsh true
// expect: other.fsh false
import { where } from "./other.fsh";

function main() {
  console.log(`${import.meta.file} ${import.meta.main}`);
  console.log(where());
}
