// expect: x
async function f() { return "x"; }
async function main() { const x = await f(); console.log(x); }
