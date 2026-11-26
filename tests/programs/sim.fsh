// expect: false 0 true
import { enabled, now, resetFaults, seed } from "fish:sim";

function main() {
  resetFaults();
  console.log(enabled(), seed(), now() >= 0);
}
