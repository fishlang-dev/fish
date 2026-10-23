// expect: 1 true true
// expect: true
// expect: true true 0 true 1
// Number literals take the element type of a sized number array, as they do with ===.
function first() {
  const f32s: f32[] = [1.0, 2.5];
  const one: f32 = 1.0;
  console.log(f32s.indexOf(2.5), f32s.includes(one), one === 1.0);
  console.log(f32s.includes(2.5));
}
function second() {
  const f32s: f32[] = [1.0, 2.5];
  const one: f32 = 1.0;
  const is: i32[] = [1, 2];
  console.log(f32s.includes(one), one === 1.0, f32s.indexOf(one), is.includes(2), is.indexOf(2));
}
function main() { first(); second(); }
