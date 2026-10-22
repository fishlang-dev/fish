// error: a 'Channel' can't hold a 'Named' yet: name a concrete type
interface Named {
  name: string;
}

function main() {
  const ch = new Channel<Named>(1);
}
