fn main() {
    let mut xs: Vec<i64> = Vec::new();
    let mut seed: i64 = 42;
    for _ in 0..2000000 {
        seed = (seed * 48271) % 2147483647;
        xs.push(seed);
    }
    xs.sort_by(|a, b| a.cmp(b));
    let mut sum = 0;
    let mut i = 0;
    while i < xs.len() {
        sum += xs[i] % 1000;
        i += 1000;
    }
    println!("{} {} {} {}", xs[0], xs[1000000], xs[1999999], sum);
}
