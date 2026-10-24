// expect: 2
// A generic function infers its type argument from a FixedArray parameter.
function count<T>(x: FixedArray<T, 2>): usize { return x.length; }
function main() { const a: FixedArray<string, 2> = ["a" + 1, "b" + 2]; console.log(count(a)); }
