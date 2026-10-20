class Counter {
  close(this: Own<this>) {}
}

function main() {}
// error: receivers other than 'this: Mut<this>' and 'this: Ref<this>' are not supported yet
