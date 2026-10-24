// expect: i1
// expect: j2
// expect: n1
// expect: m2
// Loops in a generator over fixed arrays read through a Dyn and out of an Option.
interface I { items: FixedArray<string, 2>; }
class C implements I { items: FixedArray<string, 2> = ["i" + 1, "j" + 2]; }
function* g(d: Ref<Dyn<I>>): Generator<string> { for (const v of d.items) yield v; }
function* h(o: Ref<{ a: FixedArray<string, 2> } | null>): Generator<string> { for (const v of o!.a) yield v; }
function main() {
  const d: Dyn<I> = new C();
  for (const v of g(d)) console.log(v);
  const x0: { a: FixedArray<string, 2> } = { a: ["n" + 1, "m" + 2] };
  const x: { a: FixedArray<string, 2> } | null = x0;
  for (const v of h(x)) console.log(v);
}
