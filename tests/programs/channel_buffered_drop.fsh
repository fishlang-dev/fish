// expect: sent
async function main() {
  const ch = new Channel<{ name: string; tags: string[] }>(4);
  await ch.send({ name: "a" + "", tags: ["x" + ""] });
  await ch.send({ name: "b" + "", tags: [] });
  const first = await ch.receive();
  await ch.send({ name: "c" + "", tags: ["y" + "", "z" + ""] });
  console.log("sent");
}
