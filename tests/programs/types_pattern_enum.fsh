// error: template literal pattern types in enum members are not supported yet
type Px = `${number}px`;
enum Size { Fixed(Px), Auto }
function main() {}
