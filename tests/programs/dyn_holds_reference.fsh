// error: so it can't hold a 'Ref<string>', which borrows from where it was made
interface Named {
  label(): i64;
}

class View {
  text: Ref<string>;
  constructor(text: Ref<string>) {
    this.text = text;
  }
  label(): i64 {
    return 1;
  }
}

function main() {
  const s = "abc" + "";
  const v: Dyn<Named> = new View(s);
}
