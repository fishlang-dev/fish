function id(s: Ref<string>): Ref<string> { return s; }
function main() { let o: string | null = "o" + 1; const r = id(o!); o = null; console.log(r); }
// error: cannot change 'o' while 'r' borrows 'o' and is used later
