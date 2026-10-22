// expect: true false
enum Color { Red, Green, Blue }
async function g() { await yieldNow(); return Color.Blue; }
async function main() { const y = await g(); console.log(y === Color.Blue, y === Color.Red); }
