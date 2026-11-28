function main() {
  let words = [];
  let seed = 7;
  for (let i = 0; i < 500000; i++) {
    seed = (seed * 48271) % 2147483647;
    words.push(`w${seed % 5000}`);
  }
  const text = words.join(" ");
  let counts = new Map();
  for (const word of text.split(" ")) counts.set(word, (counts.get(word) ?? 0) + 1);
  let most = 0;
  for (const n of counts.values()) if (n > most) most = n;
  console.log(text.length, counts.size, most);
}

main();
