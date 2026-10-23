// error: 'keyof' takes an object type or a class, not the interface 'Named'
interface Named { name(): string; }
type K = keyof Named;
function main() {}
