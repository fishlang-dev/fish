type R = { a: u8 };
function main() {
  const r: R = unsafe { { a: 200 } };
  const xs: u8[] = unsafe { [1, 2] };
  const s: string = unsafe { "lit" };
  const o: string | null = unsafe { "maybe" + 1 };
  console.log(r.a, xs[1], s, o ?? "none");
}
// expect: 200 2 lit maybe1
