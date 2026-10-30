use std::sync::atomic::{AtomicI64, Ordering};

static BUMPS: AtomicI64 = AtomicI64::new(0);

pub fn add(a: i64, b: i64) -> i64 {
    a + b
}

pub fn half(x: f64) -> f64 {
    x / 2.0
}

pub fn shrink(x: f32) -> f32 {
    x * 0.5
}

pub fn even(n: u8) -> bool {
    n % 2 == 0
}

pub fn wrap(n: i8) -> i8 {
    n.wrapping_add(1)
}

pub fn widths(a: u16, b: i16, c: u32, d: u64, e: isize) -> usize {
    a as usize + b as usize + c as usize + d as usize + e as usize
}

pub fn bump() {
    BUMPS.fetch_add(1, Ordering::SeqCst);
}

pub fn bumps() -> i64 {
    BUMPS.load(Ordering::SeqCst)
}

pub fn check(n: i64) -> i64 {
    if n < 0 {
        panic!("negative: {n}");
    }
    n
}

pub mod util {
    pub fn mul(a: i32, b: i32) -> i32 {
        a * b
    }
}

pub fn nul() -> i64 {
    panic!("before\0after")
}

struct Bomb;

impl Drop for Bomb {
    fn drop(&mut self) {
        panic!("dropped");
    }
}

pub fn bomb() -> i64 {
    std::panic::panic_any(Bomb)
}

static DROPS: AtomicI64 = AtomicI64::new(0);

#[derive(Clone)]
pub struct Counter {
    value: i64,
}

impl Counter {
    pub fn new(start: i64) -> Counter {
        Counter { value: start }
    }

    pub fn zero() -> Counter {
        Counter { value: 0 }
    }

    pub fn get(&self) -> i64 {
        self.value
    }

    pub fn add(&mut self, n: i64) {
        self.value += n;
    }

    pub fn finish(self) -> i64 {
        self.value * 10
    }

    pub fn fail(&self) -> i64 {
        panic!("counter at {}", self.value)
    }
}

impl Drop for Counter {
    fn drop(&mut self) {
        DROPS.fetch_add(1, Ordering::SeqCst);
    }
}

pub fn drops() -> i64 {
    DROPS.load(Ordering::SeqCst)
}

pub fn total(c: &Counter) -> i64 {
    c.value
}

pub fn bump_counter(c: &mut Counter) {
    c.value += 100;
}

pub fn consume(c: Counter) -> i64 {
    c.value + 1000
}


pub struct Bare;

impl Bare {
    pub fn make() -> Bare {
        Bare
    }
}

pub struct Grumpy;

impl Grumpy {
    pub fn new() -> Grumpy {
        Grumpy
    }
}

impl Drop for Grumpy {
    fn drop(&mut self) {
        panic!("grumpy to the end");
    }
}

// Send but not Sync: two threads bumping it at once would lose bumps.
pub struct Racy {
    value: std::cell::Cell<i64>,
}

impl Racy {
    pub fn new() -> Racy {
        Racy { value: std::cell::Cell::new(0) }
    }

    pub fn bump(&self) -> i64 {
        let v = self.value.get();
        std::thread::yield_now();
        self.value.set(v + 1);
        v
    }

    pub fn get(&self) -> i64 {
        self.value.get()
    }
}

// Not Send: it knows the thread that made it.
pub struct Pinned {
    made: std::thread::ThreadId,
    _not_send: std::marker::PhantomData<*const ()>,
}

impl Pinned {
    pub fn new() -> Pinned {
        Pinned { made: std::thread::current().id(), _not_send: std::marker::PhantomData }
    }

    pub fn same(&self) -> bool {
        self.made == std::thread::current().id()
    }
}

pub mod text {
    use super::Counter;

    pub fn greet(name: &str) -> String {
        format!("hello, {name}")
    }

    pub fn shout(s: String) -> String {
        s.to_uppercase()
    }

    pub fn label() -> &'static str {
        "a static label"
    }

    pub fn chars(s: &String) -> usize {
        s.chars().count()
    }

    pub fn code_points(s: &str) -> String {
        s.chars().map(|c| format!("{:X}", c as u32)).collect::<Vec<_>>().join(" ")
    }

    pub fn halve(n: Option<i64>) -> Option<i64> {
        n.map(|v| v / 2)
    }

    pub fn flip(b: Option<bool>) -> Option<bool> {
        b.map(|v| !v)
    }

    pub fn bracket(s: Option<&str>) -> Option<String> {
        s.map(|v| format!("<{v}>"))
    }

    pub fn find(start: i64) -> Option<Counter> {
        if start > 0 { Some(Counter::new(start)) } else { None }
    }

    pub fn value_or_zero(c: Option<Counter>) -> i64 {
        c.map(|c| c.get()).unwrap_or(0)
    }
}

impl Counter {
    pub fn named(name: &str) -> Counter {
        Counter { value: name.len() as i64 }
    }

    pub fn describe(&self) -> String {
        format!("counter {}", self.value)
    }

    pub fn tag(&self, prefix: Option<String>) -> Option<String> {
        prefix.map(|p| format!("{p}{}", self.value))
    }
}

static OOPS_DROPS: AtomicI64 = AtomicI64::new(0);

// A Rust error type Fish holds as a handle.
pub struct Oops {
    code: i64,
}

impl Oops {
    pub fn code(&self) -> i64 {
        self.code
    }
}

impl Drop for Oops {
    fn drop(&mut self) {
        OOPS_DROPS.fetch_add(1, Ordering::SeqCst);
    }
}

pub mod fallible {
    use super::{Counter, Oops};
    use std::sync::atomic::Ordering;

    pub fn oops_drops() -> i64 {
        super::OOPS_DROPS.load(Ordering::SeqCst)
    }

    pub fn parse(s: &str) -> Result<i64, std::num::ParseIntError> {
        s.parse()
    }

    pub fn check(n: i64) -> Result<i64, Oops> {
        if n < 0 { Err(Oops { code: n }) } else { Ok(n * 2) }
    }

    pub fn touch(ok: bool) -> Result<(), String> {
        if ok { Ok(()) } else { Err("touch failed".to_string()) }
    }

    pub fn make(start: i64) -> Result<Counter, Oops> {
        if start < 0 { Err(Oops { code: start }) } else { Ok(Counter::new(start)) }
    }
}

impl Counter {
    pub fn try_new(start: i64) -> Result<Counter, Oops> {
        fallible::make(start)
    }

    pub fn checked_add(&mut self, n: i64) -> Result<i64, String> {
        self.value = self.value.checked_add(n).ok_or_else(|| format!("{} + {} overflows", self.value, n))?;
        Ok(self.value)
    }
}

pub mod vectors {
    use super::Counter;

    pub fn sum(xs: &[i64]) -> i64 {
        xs.iter().sum()
    }

    pub fn len_vec(xs: &Vec<i64>) -> usize {
        xs.len()
    }

    pub fn doubled(xs: Vec<i64>) -> Vec<i64> {
        xs.into_iter().map(|x| x * 2).collect()
    }

    pub fn flags(xs: Box<[bool]>) -> Vec<bool> {
        xs.iter().map(|x| !x).collect()
    }

    pub fn words(s: &str) -> Vec<String> {
        s.split_whitespace().map(|w| w.to_string()).collect()
    }

    pub fn statics() -> Box<[&'static str]> {
        vec!["a", "b"].into_boxed_slice()
    }

    pub fn joined(xs: &[String]) -> String {
        xs.join("+")
    }

    pub fn owned_join(xs: Vec<String>) -> String {
        xs.join("-")
    }

    pub fn counters(n: i64) -> Vec<Counter> {
        (1..=n).map(Counter::new).collect()
    }

    pub fn total_all(cs: Vec<Counter>) -> i64 {
        cs.iter().map(|c| c.get()).sum()
    }

    pub fn maybe_list(n: i64) -> Option<Vec<i64>> {
        if n > 0 { Some((0..n).collect()) } else { None }
    }

    pub fn count_opt(xs: Option<Vec<i64>>) -> i64 {
        xs.map(|v| v.len() as i64).unwrap_or(-1)
    }
}

pub mod edges {
    use super::Counter;

    pub fn small(_n: i64) -> Vec<i32> {
        vec![1, 2, 3]
    }

    pub fn consume_all(s: String, xs: Vec<i64>, c: Counter, fail: bool) -> Result<i64, String> {
        if fail { Err(format!("failed with {} {} {}", s, xs.len(), c.get())) } else { Ok(xs.len() as i64 + c.get()) }
    }

    pub fn boom(s: &str, xs: &[i64], words: Vec<String>, c: Counter) -> i64 {
        panic!("boom {} {} {} {}", s, xs.len(), words.len(), c.get())
    }

    pub fn opt_words(xs: Option<Vec<String>>) -> i64 {
        xs.map(|v| v.join("").len() as i64).unwrap_or(-1)
    }

    pub fn opt_counters(cs: Option<Vec<Counter>>) -> i64 {
        cs.map(|v| v.iter().map(|c| c.get()).sum()).unwrap_or(-1)
    }

    pub fn bytes(xs: &[u8]) -> Vec<u8> {
        xs.iter().rev().copied().collect()
    }

    pub fn scale(xs: Vec<f32>) -> Vec<f32> {
        xs.into_iter().map(|x| x * 1.5).collect()
    }
}

pub mod borrow {
    // Borrows the text it was made from, so Fish can't hold one.
    pub struct Holder<'a> {
        s: &'a str,
    }

    impl Holder<'_> {
        pub fn get(&self) -> String {
            self.s.to_string()
        }
    }

    // Owns its text, so Fish can.
    pub struct Owner {
        s: String,
    }

    impl Owner {
        pub fn get(&self) -> String {
            self.s.clone()
        }
    }

    pub fn bad(s: &str) -> Result<i64, Holder<'_>> {
        Err(Holder { s })
    }

    pub fn many(s: &str) -> Vec<Holder<'_>> {
        vec![Holder { s }]
    }

    pub fn owned(s: &str) -> Vec<Owner> {
        vec![Owner { s: s.to_string() }]
    }

    pub fn owned_err(s: &str) -> Result<i64, Owner> {
        Err(Owner { s: s.to_string() })
    }

    pub struct Bag {
        v: Vec<i64>,
    }

    // Borrows the numbers it looks at, so Fish can't hold one.
    pub struct Peek<'a> {
        s: &'a [i64],
    }

    impl Peek<'_> {
        pub fn first(&self) -> i64 {
            self.s[0]
        }
    }

    // Owns its number, so Fish can.
    pub struct Item {
        n: i64,
    }

    impl Item {
        pub fn get(&self) -> i64 {
            self.n
        }
    }

    impl Bag {
        pub fn new(n: i64) -> Bag {
            Bag { v: vec![n; 3] }
        }

        pub fn views(&self) -> Vec<Peek<'_>> {
            vec![Peek { s: &self.v }]
        }

        pub fn viewe(&self) -> Result<i64, Peek<'_>> {
            Err(Peek { s: &self.v })
        }

        pub fn items(&self) -> Vec<Item> {
            self.v.iter().map(|&n| Item { n }).collect()
        }
    }

    // Borrows the counter it looks at.
    pub struct Look<'a> {
        c: &'a super::Counter,
    }

    impl Look<'_> {
        pub fn read(&self) -> i64 {
            self.c.get()
        }
    }

    pub fn looks(c: &super::Counter) -> Vec<Look<'_>> {
        vec![Look { c }]
    }
}
