// error: its method 'scaled' takes a comptime parameter, so it has a version per value and no one method a Dyn could call
// A method with a comptime parameter can't be one a Dyn calls.
class Box { scaled(comptime k: i64): i64 { return k; } }
interface Scaler { scaled(k: i64): i64; }
function main() { const d: Dyn<Scaler> = new Box(); console.log(d.scaled(2)); }
