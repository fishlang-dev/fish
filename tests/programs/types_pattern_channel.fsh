// error: template literal pattern types in channels are not supported yet
type Px = `${number}px`;
async function main() { const ch = new Channel<Px>(2); }
