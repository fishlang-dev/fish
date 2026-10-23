import { helper } from "./util";
export { helper };

var count = 0;
let total = 1;
console.log("starting");

type User = { id: number; name?: string; meta: any };

class Animal {
  #secret = 1;
  speak(): string { return "..."; }
}
class Dog extends Animal {
  @logged bark<T>(x: T): T { return x; }
}

function main(users: User[], key: string) {
  const ids = users.map((u) => u.id);
  const named = users.filter(function (u) { return u.name != null; });
  const { id, ...rest } = users[0]!;
  const m = new Map<string, number>();
  const parsed = JSON.parse("{}") as User;
  if (isNaN(parseInt(key))) return;
  if (users[0] instanceof Object) delete (users[0] as any).meta;
  const value = (users[0] as any)["name"];
  users.forEach(async (u) => { await fetch(`/u/${u.id}`); });
  setTimeout(() => {}, 10);
  for (const k in users) console.error(k);
  function inner() { return 1; }
  eval("1");
  return [ids, named, id, rest, m, parsed, value, inner, process.argv, /a+/];
}
