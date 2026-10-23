// error: 'b' doesn't live long enough: 'h' still borrows it after its block ends
class P { x = 0; tag = "p" + 1 }
class H<A extends Lifetime> {
  src: Ref<P, A>
  constructor(s: Ref<P, A>) { this.src = s }
  set(this: Mut<this>, s: Ref<P, A>) { this.src = s }
}
function main() {
  let a = new P();
  let h = new H(a);
  while (true) {
    let b = new P();
    b.x = 7;
    h.set(b);
    break;
  }
  let junk: string[] = [];
  for (let i = 0; i < 100; i++) junk.push("junk" + i);
  console.log(h.src.x, h.src.tag);
}
