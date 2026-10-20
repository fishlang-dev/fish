// mode: parse
async function f() {
  for (let i = 0; i < 10; i++) print(i)
  for (let i = 0, j = 10; i < j; i++, j--) {}
  for (;;) tick()
  for (const key in object) {}
  for (key in object) {}
  for (const [index, value] of list.entries()) {}
  for (const { id, name } of users) {}
  for (item of items) {}
  for await (const chunk of stream) {}
  for (let x = ("a" in obj); x; ) {}
  do {
    tick()
  } while (running)
  do tick(); while (running)
  do tick()
  while (running) stop()
}
