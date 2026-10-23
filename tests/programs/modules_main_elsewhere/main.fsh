// error: only the entry file's main() runs, so 'other.fsh' can't declare one
import { f } from "./other";
function main() { f(); }
