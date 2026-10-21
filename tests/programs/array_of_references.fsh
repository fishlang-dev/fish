class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
}
// error: arrays of references are not supported yet
