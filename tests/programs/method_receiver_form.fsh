class Counter {
  close(this: Box<this>) {}
}

function main() {}
// error: receivers other than 'this: Ref<this>', 'this: Mut<this>' and 'this: Own<this>' are not supported yet
