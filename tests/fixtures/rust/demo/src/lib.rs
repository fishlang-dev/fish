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
