// error: type '"px"' is not assignable to type '`${number}px`'
type Px = `${number}px`;
function main() { const p: Px = "px"; }
