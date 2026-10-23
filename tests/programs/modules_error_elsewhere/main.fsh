// error: helper.fsh:2:
// error: type '"oops"' is not assignable to return type 'i64'
import { twice } from "./helper";
function main() { console.log(twice(2)); }
