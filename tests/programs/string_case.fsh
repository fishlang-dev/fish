function main() {
  const words: string[] = ["Straße", "İstanbul", "ΟΔΥΣΣΕΥΣ", "ΣΑΣ Σ.Σ", "ΑΣ' Σ", "ﬁne ŉ ΐ", "hello World 123", "a😀B", "Σ", "ΑΣ́", "x\uD83Dy", ""];
  for (const w of words) console.log(`${w.toUpperCase()}|${w.toLowerCase()}|${w.toUpperCase().length}`);
}
// expect: STRASSE|straße|7
// expect: İSTANBUL|i̇stanbul|8
// expect: ΟΔΥΣΣΕΥΣ|οδυσσευς|8
// expect: ΣΑΣ Σ.Σ|σας σ.ς|7
// expect: ΑΣ' Σ|ας' σ|5
// expect: FINE ʼN Ϊ́|ﬁne ŉ ΐ|11
// expect: HELLO WORLD 123|hello world 123|15
// expect: A😀B|a😀b|4
// expect: Σ|σ|1
// expect: ΑΣ́|ας́|3
// expect: X�Y|x�y|3
// expect: ||0
