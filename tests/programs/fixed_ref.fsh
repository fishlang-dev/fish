// expect: s1 t 2
// A fixed array read through a reference.
function main() { let a: FixedArray<string, 2> = FixedArray.filled("s" + 1); a[1] = "t"; const r: Ref<FixedArray<string, 2>> = a; console.log(r[0], r[1], r.length); }
