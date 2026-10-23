// error: 'f' is both imported and declared in this file
import { f } from "./other";
function f() {}
function main() { f(); }
