class Base {}

class Derived extends Base {
  again(this: Mut<this>) {
    super()
  }
}

function main() {}
// error: 'super(...)' can only be the first statement of a derived class's constructor
