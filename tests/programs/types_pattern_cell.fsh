// error: template literal pattern types in 'Cell' values are not supported yet
// A Cell's methods take and give its value as a plain string, so it can't hold a pattern yet.
type Px = `${number}px`;
function main() { const c = new Cell<Px>("1px"); }
