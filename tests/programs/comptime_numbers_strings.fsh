// expect: 0.1 0.30000000000000004 1e+21 1.5e-7 0 NaN Infinity -Infinity 123456789012345680000 0.3 Infinity
// expect: 0.1 0.30000000000000004 1e+21 1.5e-7 0 NaN Infinity -Infinity 123456789012345680000 0.3 Infinity
// expect: 9007200328482816 -56 128 -3 -1 4611686018427387904 -4611686018427387904 55 3 0 255
// expect: 9007200328482816 -56 128 -3 -1 4611686018427387904 -4611686018427387904 55 3 0 255
// expect: 14 rld hél llo hé 4 4 2 3 SS école [x] [ab] [abxyzx] -aaa abbc true 56832
// expect: 14 rld hél llo hé 4 4 2 3 SS école [x] [ab] [abxyzx] -aaa abbc true 56832
// expect: false true true
// expect: false true true
// expect: 0 
// expect: 0 
// Floats, conversions and string methods give the same results at comptime as at run time.
function floats(): string {
  const a: f32 = 0.1;
  const b: f64 = 0.1 + 0.2;
  const c: f64 = 1e21;
  const d: f64 = 1.5e-7;
  const z: f64 = -0.0;
  const n: f64 = 0.0 / 0.0;
  const i: f64 = 1.0 / 0.0;
  const big: f64 = 123456789012345680000.0;
  return `${a} ${b} ${c} ${d} ${z} ${n} ${i} ${-i} ${big} ${a * 3} ${1e300 * 1e10}`;
}
function ints(): string {
  const x: i64 = 9007199791611905;
  const f = x as f32;
  const u: u8 = 200;
  const s: i8 = -128;
  const m: i64 = -9223372036854775807 - 1;
  return `${f as i64} ${(u as i8)} ${(s as u8)} ${-7 / 2} ${-7 % 2} ${m >>> 1} ${m >> 1} ${~u} ${(3.9 as i64)} ${(-3.9 as u8)} ${(300.5 as u8)}`;
}
function strs(): string {
  const s = "héllo 😀 wörld";
  const parts = "a,b,,c".split(",");
  const lim = "a,b,c".split(",", 2);
  const e = "😀a".split("");
  return `${s.length} ${s.slice(-3)} ${s.slice(-100, 3)} ${s.substring(5, 2)} ${s.substring(-1, 2)} ${s.indexOf("o", -5)} ${parts.length} ${lim.length} ${e.length} ${"ß".toUpperCase()} ${"ÉCOLE".toLowerCase()} [${" x ".trim()}] [${"ab".padStart(5, "")}] [${"ab".padEnd(6, "xyz")}] ${"aaa".replace("", "-")} ${"abc".replace("b", "$&$&")} ${s.startsWith("é", 1)} ${s.charCodeAt(7)}`;
}
function cmp(): string {
  const a = "￿";
  const b = "😀";
  return `${a < b} ${"Z" < "a"} ${"é" > "z"}`;
}
function iter(): string {
  let n = 0;
  let out = "";
  
  return `${n} ${out}`;
}
function main() {
  console.log(comptime floats());
  console.log(floats());
  console.log(comptime ints());
  console.log(ints());
  console.log(comptime strs());
  console.log(strs());
  console.log(comptime cmp());
  console.log(cmp());
  console.log(comptime iter());
  console.log(iter());
}
