use std::collections::HashMap;

fn main() {
    let mut words: Vec<String> = Vec::new();
    let mut seed: i64 = 7;
    for _ in 0..500000 {
        seed = (seed * 48271) % 2147483647;
        words.push(format!("w{}", seed % 5000));
    }
    let text = words.join(" ");
    let mut counts: HashMap<&str, i64> = HashMap::new();
    for word in text.split(' ') {
        *counts.entry(word).or_insert(0) += 1;
    }
    let most = counts.values().copied().max().unwrap_or(0);
    println!("{} {} {}", text.len(), counts.len(), most);
}
