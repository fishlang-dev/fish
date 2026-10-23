// expect: a,b,a 1,2,3 0
// concat takes literals of the element type, sized numbers and literal unions too.
type L = "a" | "b"; function main() { const xs: L[] = ["a"]; const ns: i32[] = [1]; console.log(xs.concat(["b", "a"]).join(), ns.concat([2, 3]).join(), ns.lastIndexOf(1)); }
