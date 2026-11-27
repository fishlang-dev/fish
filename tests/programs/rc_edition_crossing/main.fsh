// @fish-edition rc
// A shared object given to a file in the ownership edition is copied out for it.
// expect: apple 2 2
import { describe } from "./plain.fsh"

type Item = { name: string; qty: i64 }

function main() {
  const item: Item = { name: "apple", qty: 2 }
  const same = item
  console.log(describe(item), same.qty)
}
