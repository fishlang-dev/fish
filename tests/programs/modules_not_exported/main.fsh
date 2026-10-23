// error: 'util.fsh' has no export named 'secret'; it declares 'secret' without exporting it, so add 'export' before that declaration
import { secret } from "./util";
function main() { console.log(secret()); }
