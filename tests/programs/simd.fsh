// case: simd_arithmetic
// expect: 6 8 10 12
// expect: -4 -4 -4 -4
// expect: 5 12 21 32
// expect: 0.25 0.5
// expect: -1 -2 -3 -4
function main(): void {
  const a = f32x4(1, 2, 3, 4);
  const b = f32x4(5, 6, 7, 8);
  const s = a + b;
  const d = a - b;
  const m = a * b;
  const q = f64x2(1, 2) / f64x2(4, 4);
  const n = -a;
  console.log(s[0], s[1], s[2], s[3]);
  console.log(d[0], d[1], d[2], d[3]);
  console.log(m[0], m[1], m[2], m[3]);
  console.log(q[0], q[1]);
  console.log(n[0], n[1], n[2], n[3]);
}

// case: simd_integers_wrap
// expect: 0 1 254 255
// expect: 7 3
// expect: true false
function main(): void {
  const a = u8x16.splat(255);
  const b = u8x16.splat(1);
  const c = a + b;
  const d = a - b;
  const e = (a & b) | u8x16(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15);
  console.log(c[0], e[0], d[0], a[15]);
  const x = i32x4(1, 2, 3, 4);
  console.log((x ^ i32x4.splat(6))[0], (x | i32x4.splat(1))[2]);
  console.log(x === i32x4(1, 2, 3, 4), x !== i32x4(1, 2, 3, 4));
}

// case: simd_reductions
// expect: 10 1 4
// expect: 140 -8 7
// expect: 2.5
function main(): void {
  const v = f64x4(1, 2, 3, 4);
  console.log(v.sum(), v.min(), v.max());
  const i = i8x16(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16);
  const w = i16x8(-8, 1, 2, 3, 4, 5, 6, 7);
  console.log(i32x8(1, 2, 3, 4, 5, 6, 7, 8).sum() + i32x8.splat(13).sum(), w.min(), w.max());
  console.log((v / f64x4.splat(4)).sum());
  const _unused = i.sum();
}

// case: simd_masks
// expect: true false true false
// expect: true false
// expect: 1 40 3 60
// expect: false true
function main(): void {
  const a = i32x4(1, 5, 3, 7);
  const b = i32x4(2, 4, 4, 6);
  const lt = a.lt(b);
  console.log(lt[0], lt[1], lt[2], lt[3]);
  console.log(lt.any(), lt.all());
  const picked = lt.select(a, b * i32x4.splat(10));
  console.log(picked[0], picked[1], picked[2], picked[3]);
  const none = !(lt | a.ge(b));
  console.log(none.any(), (lt ^ lt.select(i32x4.splat(0), i32x4.splat(0)).eq(i32x4.splat(1))).any());
}

// case: simd_load_store
// expect: 3 5 7 9
// expect: 0 30 50 70 90
// panic: index out of bounds
function main(): void {
  let xs: f32[] = [1, 2, 3, 4, 5];
  let ys: f32[] = [2, 3, 4, 5, 6];
  const sum = f32x4.load(xs, 0) + f32x4.load(ys, 0);
  console.log(sum[0], sum[1], sum[2], sum[3]);
  let out: f32[] = [0, 0, 0, 0, 0];
  (sum * f32x4.splat(10)).store(out, 1);
  console.log(out[0], out[1], out[2], out[3], out[4]);
  const tooFar = f32x4.load(xs, 2);
  console.log(tooFar[0]);
}

// case: simd_lane_write_and_to_array
// expect: 1 9 3 4
// expect: 4
function main(): void {
  let v = u32x4(1, 2, 3, 4);
  v[1] = 9;
  const a: FixedArray<u32, 4> = v.toArray();
  console.log(a[0], a[1], a[2], a[3]);
  console.log(a.length);
}

// case: simd_type_errors_mix
// error: operator '+' takes two 'f32x4' vectors; 'i32x4' isn't one
function main(): void {
  const x = f32x4.splat(1) + i32x4.splat(1);
}

// case: simd_type_errors_compare
// error: operator '<' doesn't compare vectors; compare their lanes with 'lt'
function main(): void {
  const x = f32x4.splat(1) < f32x4.splat(2);
}

// case: simd_type_errors_integer_division
// error: lane-wise integer division
function main(): void {
  const x = i32x4.splat(1) / i32x4.splat(2);
}

// case: simd_type_errors_lanes
// error: 'f32x4' takes its 4 lanes
function main(): void {
  const x = f32x4(1, 2, 3);
}

// case: simd_type_errors_method
// error: 'mask4' has no method 'sum'
function main(): void {
  const m = f32x4.splat(1).lt(f32x4.splat(2));
  const s = m.sum();
}
