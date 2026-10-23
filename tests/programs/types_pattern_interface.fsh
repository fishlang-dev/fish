// error: template literal pattern types in interface methods are not supported yet
type Px = `${number}px`;
interface Sized { size(): Px; }
function main() {}
